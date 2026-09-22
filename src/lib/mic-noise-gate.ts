/**
 * A lightweight, real-time downward expander applied to the mic signal MediaRecorder actually
 * captures — so background/room noise sitting between words is already reduced in the take that
 * gets saved and uploaded, not just cleaned up afterward. mix-recording.ts's own applyNoiseGate
 * still runs on top of this during the offline mixdown (it can see the *whole* take and adapt its
 * threshold to it — this one can't, it only ever sees the last few hundred milliseconds); the two
 * are complementary, not redundant — this one is what keeps the raw/rawVocalUrl upload itself
 * cleaner too, which the offline pass alone never touches.
 *
 * Deliberately never touches the live "hear yourself" monitor graph in record.tsx — that stream
 * needs the shortest possible signal path to stay low-latency (see MONITOR_CONSTRAINTS there), and
 * runs through an AudioWorkletNode of its own here regardless would add a render-quantum's worth
 * of delay for no benefit, since nobody hears this copy live.
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
export async function createLiveNoiseGate(
  ctx: AudioContext,
  source: AudioNode,
): Promise<LiveNoiseGate> {
  const fallback: LiveNoiseGate = { node: source, dispose: () => {} };
  if (typeof ctx.audioWorklet === "undefined") return fallback;
  try {
    await ensureWorkletModule(ctx);
    const gateNode = new AudioWorkletNode(ctx, "mic-noise-gate", {
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
