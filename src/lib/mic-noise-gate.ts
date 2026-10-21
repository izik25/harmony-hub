/**
 * A lightweight, real-time downward expander applied to the mic signal MediaRecorder actually
 * captures — so background/room noise sitting between words is already reduced in the take that
 * gets saved and uploaded, not just cleaned up afterward. mix-recording.ts's own applyNoiseGate
 * still runs on top of this during the offline mixdown (it can see the *whole* take and adapt its
 * threshold to it — this one can't, it only ever sees the last few hundred milliseconds); the two
 * are complementary, not redundant — this one is what keeps the raw/rawVocalUrl upload itself
 * cleaner too, which the offline pass alone never touches.
 *
 * The live "hear yourself" monitor in record.tsx gets its own, more aggressive processor from this
 * same module (see createMonitorGate) rather than this one. An AudioWorkletNode adds no delay of
 * its own — it runs synchronously inside the same render quantum as the rest of the graph — so
 * gating the monitor costs no latency, only the gate's own (sub-millisecond) attack.
 *
 * Runs as an AudioWorkletProcessor (off the main thread) rather than a deprecated
 * ScriptProcessorNode, registered from an in-memory Blob URL so it doesn't need its own file
 * served from the app's public assets.
 */

// Same attack/dip philosophy as applyNoiseGate in mix-recording.ts (fast attack, slow release, a
// gentle dip rather than a hard mute so word tails don't get chopped) — but the threshold here
// can't be computed from the whole take up front the way the offline pass does. Instead it tracks
// a live noise-floor estimate with an asymmetric envelope follower: chases downward quickly
// (toward room tone/backing-track bleed in the gaps between phrases) but rises only slowly, so a
// sustained loud vocal phrase is never mistaken for "the new floor."
const WORKLET_SOURCE = `
class MicNoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._floor = 0.0005; // ~ -66dB, a conservative guess before any real signal has arrived
    this._gain = 1;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    for (let ch = 0; ch < input.length; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      if (!inCh || !outCh) continue;
      for (let i = 0; i < inCh.length; i++) {
        const sample = inCh[i];
        const mag = Math.abs(sample);
        if (mag < this._floor) this._floor += (mag - this._floor) * 0.02;
        else this._floor += (mag - this._floor) * 0.00005;
        const thresholdLin = this._floor * 3.16; // ~+10dB above the tracked floor
        const target = mag >= thresholdLin ? 1 : 0.12; // a dip, not a mute
        const step = target > this._gain ? 0.02 : 0.0006; // fast attack, slow release
        this._gain += (target - this._gain) * step;
        outCh[i] = sample * this._gain;
      }
    }
    return true;
  }
}
registerProcessor("mic-noise-gate", MicNoiseGateProcessor);

// The monitor's capture has NS/AGC off (they'd add latency), so without this every bit of room
// noise goes straight into the singer's headphones. A level-only gate isn't enough here: a shirt
// rustle or a tap on the phone is easily as loud at the capsule as a voice. So the gate only
// *opens* on sound that looks like singing — enough energy in the 150-1200Hz band where a voice's
// fundamental and first formant sit (rustle/hiss/clicks are mostly above it, handling thumps below
// it), sustained for a few milliseconds (clicks and taps are shorter). Once open it stays open on
// level alone, with a hold, so consonants and word tails inside a phrase still come through.
// Closed, it dips the signal to near-silence.
class MonitorGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const ms = (t) => 1 - Math.exp(-1 / (sampleRate * t / 1000));
    const hz = (f) => 1 - Math.exp(-2 * Math.PI * f / sampleRate);
    this._hp = hz(150);
    this._lp = hz(1200);
    this._envAttack = ms(1);
    this._envRelease = ms(50);
    this._floorDown = ms(100);
    this._floorUp = ms(8000);
    this._gainAttack = ms(3);
    this._gainRelease = ms(120);
    this._armSamples = Math.round(sampleRate * 0.008);
    this._holdSamples = Math.round(sampleRate * 0.15);
    this._lp1 = 0; this._lp2 = 0; this._b1 = 0; this._b2 = 0;
    this._band = 0;
    this._full = 0;
    this._floor = 0.0005; // ~-66dB; rises to the real room level within seconds
    this._armed = 0;
    this._hold = 0;
    this._gain = 0;
  }
  process(inputs, outputs) {
    const inCh = inputs[0] && inputs[0][0];
    const outCh = outputs[0] && outputs[0][0];
    if (!inCh || !outCh) return true;
    for (let i = 0; i < inCh.length; i++) {
      const sample = inCh[i];
      // Detector-only band split (the audio itself passes through unfiltered): two one-pole
      // highpasses at 150Hz, then two one-pole lowpasses at 1200Hz.
      this._lp1 += (sample - this._lp1) * this._hp;
      const h1 = sample - this._lp1;
      this._lp2 += (h1 - this._lp2) * this._hp;
      const h2 = h1 - this._lp2;
      this._b1 += (h2 - this._b1) * this._lp;
      this._b2 += (this._b1 - this._b2) * this._lp;
      const band = Math.abs(this._b2);
      const full = Math.abs(sample);
      this._band += (band - this._band) * (band > this._band ? this._envAttack : this._envRelease);
      this._full += (full - this._full) * (full > this._full ? this._envAttack : this._envRelease);
      // The floor only creeps up while the gate is closed — otherwise a long sustained note would
      // slowly become "the room" and close the gate on itself mid-phrase.
      if (this._band < this._floor) this._floor += (this._band - this._floor) * this._floorDown;
      else if (this._hold === 0) this._floor += (this._band - this._floor) * this._floorUp;
      // ~+16dB over the room's own voice-band level, and never below ~-50dBFS.
      const threshold = Math.max(this._floor * 6, 0.003);
      const voiced = this._band >= threshold && this._band >= this._full * 0.45;
      if (this._hold > 0) {
        // Already open: stays open on level alone (with some hysteresis), refreshing the hold.
        if (this._band >= threshold * 0.7) this._hold = this._holdSamples;
        else if (--this._hold === 0) this._armed = 0;
      } else if (voiced) {
        if (++this._armed >= this._armSamples) this._hold = this._holdSamples;
      } else {
        this._armed = 0;
      }
      const target = this._hold > 0 ? 1 : 0.02; // ~-34dB closed
      this._gain += (target - this._gain) * (target > this._gain ? this._gainAttack : this._gainRelease);
      outCh[i] = sample * this._gain;
    }
    return true;
  }
}
registerProcessor("monitor-gate", MonitorGateProcessor);
`;

// AudioWorklet module registration is per-AudioContext and can't be undone, so this is cached per
// context instead of attempted again on every call.
const registered = new WeakMap<AudioContext, Promise<void>>();

function ensureWorkletModule(ctx: AudioContext): Promise<void> {
  let pending = registered.get(ctx);
  if (!pending) {
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    pending = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    registered.set(ctx, pending);
  }
  return pending;
}

export type LiveNoiseGate = {
  /** The gated audio, as a Web Audio node — connect this (not the raw source) into whatever
   * actually needs the cleaned-up signal, e.g. a MediaStreamAudioDestinationNode feeding
   * MediaRecorder. */
  node: AudioNode;
  /** Tears down just this gate's own node — leaves `source` and `ctx` alone, since callers
   * typically still need those for other things (the level meter, the context's own lifecycle). */
  dispose: () => void;
};

/**
 * Splices a live noise gate onto an existing Web Audio node — typically a
 * MediaStreamAudioSourceNode already feeding a level-meter AnalyserNode elsewhere, so the mic
 * capsule is only ever tapped once. Falls back to passing `source` straight through untouched if
 * AudioWorklet isn't available or registration fails for any reason — noise reduction is a
 * nice-to-have, not something a take should ever be lost over.
 */
export function createLiveNoiseGate(ctx: AudioContext, source: AudioNode): Promise<LiveNoiseGate> {
  return createGate(ctx, source, "mic-noise-gate");
}

/**
 * The live monitor's gate — see MonitorGateProcessor above. Same fallback contract as
 * createLiveNoiseGate: if it can't be built, `source` passes through ungated.
 */
export function createMonitorGate(ctx: AudioContext, source: AudioNode): Promise<LiveNoiseGate> {
  return createGate(ctx, source, "monitor-gate");
}

async function createGate(
  ctx: AudioContext,
  source: AudioNode,
  processorName: "mic-noise-gate" | "monitor-gate",
): Promise<LiveNoiseGate> {
  const fallback: LiveNoiseGate = { node: source, dispose: () => {} };
  if (typeof ctx.audioWorklet === "undefined") return fallback;
  try {
    await ensureWorkletModule(ctx);
    const gateNode = new AudioWorkletNode(ctx, processorName, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    source.connect(gateNode);
    return {
      node: gateNode,
      dispose: () => {
        try {
          source.disconnect(gateNode);
        } catch {
          // already disconnected (e.g. the context was closed first) — nothing left to undo
        }
        gateNode.disconnect();
      },
    };
  } catch (err) {
    console.error(err);
    return fallback;
  }
}
