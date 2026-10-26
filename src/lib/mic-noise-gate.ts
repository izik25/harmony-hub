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
 * createMonitorVoice) rather than this one — expander, compressor and limiter in one. An
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

// The live monitor's "headphone mix" voice chain, in one zero-lookahead pass — what a studio
// engineer puts on a singer's cue feed: no gate chopping the starts of words, just a soft
// downward expander that only tucks the room ~20dB under once you stop singing, a gentle
// compressor so soft and belted lines sit at the same, comfortable level, makeup gain (the
// capture has AGC off, so a raw phone capsule is quiet and uneven), and a fast peak limiter so a
// loud note can never blast the headphones. Nothing here looks ahead, so it adds no latency.
//
// The old gate (fully silent until it heard ~8ms of "voice-band" energy) cut every consonant at
// the start of a phrase and dropped out on soft notes, which is most of why monitoring sounded bad.
class MonitorVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const ms = (t) => 1 - Math.exp(-1 / (sampleRate * t / 1000));
    this._detAttack = ms(1);
    this._detRelease = ms(60);
    this._floorDown = ms(150);
    this._floorRiseDb = 3 / sampleRate; // the floor creeps up at most 3dB/s
    this._expAttack = ms(0.5);
    this._expRelease = ms(250);
    this._holdSamples = Math.round(sampleRate * 0.25);
    this._compAttack = ms(4);
    this._compRelease = ms(160);
    this._limRelease = ms(80);
    this._env = 0;
    this._floorDb = -66; // a conservative guess before any real signal has arrived
    this._hold = 0;
    this._exp = 0.1;
    this._compDb = 0;
    this._lim = 1;
  }
  process(inputs, outputs) {
    const inCh = inputs[0] && inputs[0][0];
    const outCh = outputs[0] && outputs[0][0];
    if (!inCh || !outCh) return true;
    for (let i = 0; i < inCh.length; i++) {
      const x = inCh[i];
      const mag = Math.abs(x);
      this._env += (mag - this._env) * (mag > this._env ? this._detAttack : this._detRelease);
      const envDb = 20 * Math.log10(this._env + 1e-9);

      // Room-level estimate: drops fast to the quiet between phrases, rises only slowly (in dB,
      // so it can't stay stuck under a noisy room either) — a sustained note never becomes "the room".
      if (envDb < this._floorDb) this._floorDb += (envDb - this._floorDb) * this._floorDown;
      else this._floorDb += this._floorRiseDb;
      // Opens instantly on anything ~10dB over the room (never below -60dBFS), then holds.
      if (envDb >= Math.max(this._floorDb + 10, -60)) this._hold = this._holdSamples;
      else if (this._hold > 0) this._hold--;
      const expTarget = this._hold > 0 ? 1 : 0.1; // a -20dB dip, not a mute
      this._exp += (expTarget - this._exp) * (expTarget > this._exp ? this._expAttack : this._expRelease);

      // Soft-knee 3:1 over -28dBFS, +10dB makeup.
      const over = envDb + 28;
      let reduceDb = 0;
      if (over >= 4) reduceDb = over * (2 / 3);
      else if (over > -4) reduceDb = ((over + 4) * (over + 4)) / 16 * (2 / 3);
      this._compDb += (reduceDb - this._compDb) * (reduceDb > this._compDb ? this._compAttack : this._compRelease);
      const y = x * this._exp * Math.pow(10, (10 - this._compDb) / 20);

      // Peak limiter at -3dBFS, leaving room for the reverb sitting on top.
      const peak = Math.abs(y) * this._lim;
      if (peak > 0.7) this._lim = 0.7 / Math.abs(y);
      else this._lim += (1 - this._lim) * this._limRelease;
      outCh[i] = y * this._lim;
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
