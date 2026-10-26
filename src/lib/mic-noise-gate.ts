/**
 * A lightweight, real-time downward expander applied to the mic signal MediaRecorder actually
 * captures — so background/room noise sitting between words is already reduced in the take that
 * gets saved and uploaded, not just cleaned up afterward. mix-recording.ts's own applyNoiseGate
 * still runs on top of this during the offline mixdown (it can see the *whole* take and adapt its
 * threshold to it — this one can't, it only ever sees the last few hundred milliseconds); the two
 * are complementary, not redundant — this one is what keeps the raw/rawVocalUrl upload itself
 * cleaner too, which the offline pass alone never touches.
 *
 * The live "hear yourself" monitor in record.tsx gets its own processor from this same module (see
 * createMonitorVoice) rather than this one — a soft expander and a gentle compressor. An
 * AudioWorkletNode adds no delay of its own — it runs synchronously inside the same render quantum
 * as the rest of the graph — so processing the monitor costs no latency.
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

// The live monitor's voice processing, kept deliberately light: a soft expander that only eases
// the room ~12dB down once you stop singing (it opens within ~2ms, so the start of a word is never
// cut, and it never mutes) and a gentle 2:1 compressor that just takes the edge off loud notes.
// No makeup gain and no hard limiter — boosting the capsule brought its hiss up with it, and a
// limiter's instant gain jumps distort. Nothing here looks ahead, so it adds no latency, and the
// gain targets are only recomputed every 16 samples (a third of a millisecond), which keeps it
// cheap enough for the tiny low-latency render buffers phones run the monitor at.
class MonitorVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const ms = (t) => 1 - Math.exp(-1 / (sampleRate * t / 1000));
    const blockMs = (t) => 1 - Math.exp(-16 / (sampleRate * t / 1000));
    this._detAttack = ms(1);
    this._detRelease = ms(80);
    this._floorDown = blockMs(200);
    this._floorRiseDb = (3 * 16) / sampleRate; // the room estimate creeps up at most 3dB/s
    this._holdBlocks = Math.round((sampleRate * 0.3) / 16);
    this._expAttack = ms(2);
    this._expRelease = ms(250);
    this._compAttack = ms(5);
    this._compRelease = ms(150);
    this._env = 0;
    this._floorDb = -66; // a conservative guess before any real signal has arrived
    this._hold = 0;
    this._expTarget = 1;
    this._exp = 1;
    this._compTarget = 1;
    this._comp = 1;
    this._n = 0;
  }
  process(inputs, outputs) {
    const inCh = inputs[0] && inputs[0][0];
    const outCh = outputs[0] && outputs[0][0];
    if (!inCh || !outCh) return true;
    for (let i = 0; i < inCh.length; i++) {
      const x = inCh[i];
      const mag = Math.abs(x);
      this._env += (mag - this._env) * (mag > this._env ? this._detAttack : this._detRelease);
      if (++this._n === 16) {
        this._n = 0;
        const envDb = 20 * Math.log10(this._env + 1e-9);
        // Drops fast to the quiet between phrases, rises only slowly, so a held note never
        // becomes "the room" (and a noisy room can't leave it stuck open either).
        if (envDb < this._floorDb) this._floorDb += (envDb - this._floorDb) * this._floorDown;
        else this._floorDb += this._floorRiseDb;
        if (envDb >= Math.max(this._floorDb + 10, -60)) this._hold = this._holdBlocks;
        else if (this._hold > 0) this._hold--;
        this._expTarget = this._hold > 0 ? 1 : 0.25;
        // 2:1 above -20dBFS with a 6dB soft knee.
        const over = envDb + 20;
        const reduceDb = over >= 3 ? over / 2 : over > -3 ? ((over + 3) * (over + 3)) / 24 : 0;
        this._compTarget = Math.pow(10, -reduceDb / 20);
      }
      this._exp += (this._expTarget - this._exp) * (this._expTarget > this._exp ? this._expAttack : this._expRelease);
      this._comp += (this._compTarget - this._comp) * (this._compTarget < this._comp ? this._compAttack : this._compRelease);
      outCh[i] = x * this._exp * this._comp;
    }
    return true;
  }
}
registerProcessor("monitor-voice", MonitorVoiceProcessor);
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
 * The live monitor's voice chain — see MonitorVoiceProcessor above. Same fallback contract as
 * createLiveNoiseGate: if it can't be built, `source` passes through unprocessed.
 */
export function createMonitorVoice(ctx: AudioContext, source: AudioNode): Promise<LiveNoiseGate> {
  return createGate(ctx, source, "monitor-voice");
}

async function createGate(
  ctx: AudioContext,
  source: AudioNode,
  processorName: "mic-noise-gate" | "monitor-voice",
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
