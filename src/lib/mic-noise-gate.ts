/**
 * The live "hear yourself" monitor's voice processing in record.tsx — a soft expander and a gentle
 * compressor (see MonitorVoiceProcessor below). An AudioWorkletNode adds no delay of its own — it
 * runs synchronously inside the same render quantum as the rest of the graph — so processing the
 * monitor costs no latency.
 *
 * The recorded take itself gets nothing live: it's captured clean and its noise comes out offline,
 * where the whole take can be seen at once (noise-reduction.ts, then the gate in mix-recording.ts).
 *
 * Runs as an AudioWorkletProcessor (off the main thread) rather than a deprecated
 * ScriptProcessorNode, registered from an in-memory Blob URL so it doesn't need its own file
 * served from the app's public assets.
 */

const WORKLET_SOURCE = `
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
  /** The processed audio, as a Web Audio node — connect this (not the raw source) onward. */
  node: AudioNode;
  /** Tears down just this node — leaves `source` and `ctx` alone, since callers still own those. */
  dispose: () => void;
};

/**
 * Splices the monitor's voice chain (MonitorVoiceProcessor above) onto an existing Web Audio node.
 * Falls back to passing `source` straight through untouched if AudioWorklet isn't available or
 * registration fails for any reason — the monitor should still play, just unprocessed.
 */
export async function createMonitorVoice(
  ctx: AudioContext,
  source: AudioNode,
): Promise<LiveNoiseGate> {
  const fallback: LiveNoiseGate = { node: source, dispose: () => {} };
  if (typeof ctx.audioWorklet === "undefined") return fallback;
  try {
    await ensureWorkletModule(ctx);
    const gateNode = new AudioWorkletNode(ctx, "monitor-voice", {
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
