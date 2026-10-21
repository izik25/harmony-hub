import * as Tone from "tone";
import { generateImpulseResponse } from "./impulse-response";

/**
 * Studio's vocal chain — one standard lead-vocal chain in the usual order, every stage set from
 * published engineering practice rather than taste:
 *
 *   trim (to −18 dBFS) → high-pass 24dB/oct → mud cut → de-esser (split-band) → compressor
 *   (3.5:1) → presence → air shelf → saturation → trim back → dry + plate reverb send + delay send
 *   → vocal level ─┐
 *   backing → backing level ─┴→ master gain → limiter (−1 dB ceiling)
 *
 * Gain staging matters more than any single knob: the compressor and de-esser thresholds below are
 * defined relative to −18 dBFS, so the trim brings every take there first (whatever level it was
 * recorded at) and the output trim hands the same level back — those stages then do what their
 * settings say on a quiet take and a hot one alike.
 */

/** Everything the Studio sliders and AI mastering control. */
export type MixSettings = {
  /** Playback speed, %. */
  speed: number;
  /** Gain-staging trim (dB) that brings the take's loud passages to −18 dBFS — measured on load. */
  inputTrimDb: number;
  /** 0-100 → high-pass at 50-150Hz. */
  lowCut: number;
  /** dB cut at ~300Hz, 0-6. */
  mudCutDb: number;
  /** 0-100 → 0-8 dB of gain reduction on the loudest "s" sounds. */
  deEss: number;
  /** Level (dBFS, before the trim) of the take's loudest sibilance — what deEss is relative to. */
  deEssRefDb: number;
  /** De-esser crossover, Hz. */
  deEssHz: number;
  /** 0-100 → 0-9 dB of gain reduction on loud phrases, at 3.5:1. */
  compression: number;
  /** dB at ~3.2kHz, −6..6. */
  presenceDb: number;
  /** dB high shelf from 10kHz, −6..6. */
  airDb: number;
  /** 0-100 → parallel soft saturation blend. */
  warmth: number;
  /** 0-100 → reverb send. */
  reverb: number;
  /** 0-100 → plate decay 0.6-2.4s (see reverbTailSeconds). */
  reverbSize: number;
  /** Reverb pre-delay, seconds. */
  preDelay: number;
  /** 0-100 → delay send. */
  delay: number;
  /** Delay time, seconds — a dotted eighth of the song's tempo when AI mastering found one. */
  delayTime: number;
  /** Master gain into the limiter, dB. */
  gainDb: number;
  /** Mix balance, %. */
  vocalVolume: number;
  playbackVolume: number;
};

export const DEFAULT_MIX: MixSettings = {
  speed: 100,
  inputTrimDb: 0,
  lowCut: 30,
  mudCutDb: 0,
  deEss: 0,
  deEssRefDb: -30,
  deEssHz: 6500,
  compression: 35,
  presenceDb: 0,
  airDb: 0,
  warmth: 0,
  // A light touch by default; AI mastering sets the real amount from the song.
  reverb: 15,
  reverbSize: 30,
  preDelay: 0.03,
  delay: 0,
  delayTime: 0.375,
  gainDb: 0,
  // 115/95 match record.tsx's initial auto-mix.
  vocalVolume: 115,
  playbackVolume: 95,
};

export const reverbTailSeconds = (size: number) => 0.6 + (size / 100) * 1.8;
export const compressionGrDb = (compression: number) => (compression / 100) * 9;
export const deEssGrDb = (deEss: number) => (deEss / 100) * 8;

const COMP_RATIO = 3.5;
const DE_ESS_RATIO = 4;
const STAGED_LEVEL_DB = -18;
// The compressor's detector follows the signal's peaks, which on a staged vocal's loud phrases ride
// about 3dB over the −18 RMS level — measured: thresholds set from −18 itself took ~2dB more than
// asked. Thresholds are set from this so the dial's gain reduction is what actually happens.
const DETECTOR_LEVEL_DB = STAGED_LEVEL_DB + 3;
// Two Web Audio DynamicsCompressorNode behaviors every compressor here has to account for, both
// measured in Chromium:
//  - a fixed 6ms lookahead (truncated to whole samples) — the de-esser's untouched low band and
//    the backing are delayed to match, so nothing smears or drifts off the beat;
//  - built-in makeup gain, (1 / full-range gain)^0.6 per the spec — e.g. +8dB at a −22dB
//    threshold — applied to everything, quiet signals included. Left in, it makes the compressor
//    slider a volume knob and turns the de-esser into a treble boost; makeupDb models it
//    (within ~0.1dB above a −5dB threshold) so each compressor's output is trimmed back by it.
const compressorLatency = (sampleRate: number) => Math.floor(0.006 * sampleRate) / sampleRate;
const makeupDb = (threshold: number, ratio: number, knee: number) =>
  Math.max(0, 0.6 * (1 - 1 / ratio) * (-threshold - 0.43 * knee));
const COMP_KNEE = 6;
const DE_ESS_KNEE = 3;
const LIMITER_THRESHOLD = -1;
// Web Audio's high/low-pass Q is resonance in dB; −3.01 dB is Butterworth, and two cascaded
// Butterworth stages at the same frequency make a Linkwitz-Riley crossover whose low and high
// halves sum back flat. Built from Tone.BiquadFilter, which passes Q straight to the native node —
// Tone.Filter only accepts a positive Q.
const BUTTERWORTH_Q_DB = -3.0103;
const butterworth = (type: "lowpass" | "highpass") =>
  new Tone.BiquadFilter({ type, frequency: 1000, Q: BUTTERWORTH_Q_DB });

export type VocalChain = {
  player: Tone.Player;
  backingPlayer: Tone.Player;
  inputTrim: Tone.Gain;
  highpass: Tone.BiquadFilter;
  highpass2: Tone.BiquadFilter;
  mud: Tone.Filter;
  deEssLow: Tone.BiquadFilter;
  deEssLow2: Tone.BiquadFilter;
  deEssLowDelay: Tone.Delay;
  deEssHigh: Tone.BiquadFilter;
  deEssHigh2: Tone.BiquadFilter;
  deEssComp: Tone.Compressor;
  deEssMakeupTrim: Tone.Gain;
  deEssSum: Tone.Gain;
  compressor: Tone.Compressor;
  compMakeup: Tone.Gain;
  presence: Tone.Filter;
  air: Tone.Filter;
  saturator: Tone.WaveShaper;
  saturationWet: Tone.Gain;
  saturationDry: Tone.Gain;
  outputTrim: Tone.Gain;
  reverbSendHighpass: Tone.Filter;
  reverbSendLowpass: Tone.Filter;
  reverbConvolver: Tone.Convolver;
  reverbWet: Tone.Gain;
  delaySend: Tone.Gain;
  delayHighpass: Tone.Filter;
  delayLowpass: Tone.Filter;
  delay: Tone.FeedbackDelay;
  vocalBus: Tone.Gain;
  vocalLevel: Tone.Gain;
  backingDelay: Tone.Delay;
  backingLevel: Tone.Gain;
  masterGain: Tone.Gain;
  limiter: Tone.Compressor;
  limiterTrim: Tone.Gain;
};

// Which impulse response each chain's convolver currently holds — not a field on VocalChain
// itself, since disposeChain disposes every field.
const impulseKeys = new WeakMap<VocalChain, string>();

export function buildChain(): VocalChain {
  const latency = compressorLatency(Tone.getContext().sampleRate);
  const player = new Tone.Player();
  const backingPlayer = new Tone.Player();
  const inputTrim = new Tone.Gain(1);
  // 24dB/oct: two Butterworth stages.
  const highpass = butterworth("highpass");
  const highpass2 = butterworth("highpass");
  const mud = new Tone.Filter({ type: "peaking", frequency: 300, Q: 1.4, gain: 0 });

  // Split-band de-esser: only the band above the crossover is compressed, so taming "s" sounds
  // never dulls the rest of the voice the way a full-band de-esser or a static cut would.
  const deEssLow = butterworth("lowpass");
  const deEssLow2 = butterworth("lowpass");
  const deEssLowDelay = new Tone.Delay(latency);
  const deEssHigh = butterworth("highpass");
  const deEssHigh2 = butterworth("highpass");
  const deEssComp = new Tone.Compressor({
    ratio: DE_ESS_RATIO,
    attack: 0.001,
    release: 0.05,
    knee: DE_ESS_KNEE,
    threshold: 0,
  });
  const deEssMakeupTrim = new Tone.Gain(1);
  const deEssSum = new Tone.Gain(1);

  // Medium attack lets each word's consonant through before the compressor grabs it (keeps the
  // vocal articulate); a short release recovers between syllables instead of pumping.
  const compressor = new Tone.Compressor({
    ratio: COMP_RATIO,
    attack: 0.01,
    release: 0.08,
    knee: COMP_KNEE,
    threshold: 0,
  });
  const compMakeup = new Tone.Gain(1);
  const presence = new Tone.Filter({ type: "peaking", frequency: 3200, Q: 0.9, gain: 0 });
  const air = new Tone.Filter({ type: "highshelf", frequency: 10000, gain: 0 });

  // Parallel soft saturation: odd harmonics from a tanh curve with unity small-signal gain, blended
  // under the clean signal — density and warmth without audible distortion.
  const drive = 3;
  const saturator = new Tone.WaveShaper((x) => Math.tanh(drive * x) / drive, 4096);
  const saturationWet = new Tone.Gain(0);
  const saturationDry = new Tone.Gain(1);
  const outputTrim = new Tone.Gain(1);

  // Sends, filtered on the way in: no lows (muddy, boomy tails) and no top end (sibilance smeared
  // into the tail). Plate reverb 400Hz-8kHz; delay repeats 200Hz-5kHz so they sit behind the voice.
  const rawContext = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const reverbSendHighpass = new Tone.Filter({ type: "highpass", frequency: 400 });
  const reverbSendLowpass = new Tone.Filter({ type: "lowpass", frequency: 8000 });
  const reverbConvolver = new Tone.Convolver(generateImpulseResponse(rawContext));
  const reverbWet = new Tone.Gain(0);
  const delaySend = new Tone.Gain(0);
  const delayHighpass = new Tone.Filter({ type: "highpass", frequency: 200 });
  const delayLowpass = new Tone.Filter({ type: "lowpass", frequency: 5000 });
  const delay = new Tone.FeedbackDelay({ delayTime: 0.375, feedback: 0.2, maxDelay: 2, wet: 1 });

  const vocalBus = new Tone.Gain(1);
  const vocalLevel = new Tone.Gain(1);
  // The vocal path runs through two compressors' lookahead (de-esser, compressor); delaying the
  // backing by the same keeps the take exactly on the beat it was sung to.
  const backingDelay = new Tone.Delay(latency * 2);
  const backingLevel = new Tone.Gain(1);
  const masterGain = new Tone.Gain(1);
  // A hard-knee limiter with a 100ms release. Tone's own Limiter hardcodes a 10ms release (tracks
  // the waveform → distortion), and Compressor's default 30dB knee would start squashing the
  // whole mix some 15dB below the ceiling.
  const limiter = new Tone.Compressor({
    ratio: 20,
    attack: 0.002,
    release: 0.1,
    knee: 0,
    threshold: LIMITER_THRESHOLD,
  });
  // Takes the limiter's own makeup back off, so the ceiling really is −1dB.
  const limiterTrim = new Tone.Gain(
    Tone.dbToGain(-makeupDb(LIMITER_THRESHOLD, 20, 0)),
  ).toDestination();

  player.chain(inputTrim, highpass, highpass2, mud);
  mud.fan(deEssLow, deEssHigh);
  deEssLow.chain(deEssLow2, deEssLowDelay, deEssSum);
  deEssHigh.chain(deEssHigh2, deEssComp, deEssMakeupTrim, deEssSum);
  deEssSum.chain(compressor, compMakeup, presence, air);
  air.fan(saturationDry, saturator);
  saturator.connect(saturationWet);
  saturationDry.connect(outputTrim);
  saturationWet.connect(outputTrim);
  outputTrim.fan(vocalBus, reverbSendHighpass, delaySend);
  reverbSendHighpass.chain(reverbSendLowpass, reverbConvolver, reverbWet, vocalBus);
  delaySend.chain(delayHighpass, delayLowpass, delay, vocalBus);
  vocalBus.chain(vocalLevel, masterGain);
  backingPlayer.chain(backingDelay, backingLevel, masterGain);
  masterGain.chain(limiter, limiterTrim);

  return {
    player,
    backingPlayer,
    inputTrim,
    highpass,
    highpass2,
    mud,
    deEssLow,
    deEssLow2,
    deEssLowDelay,
    deEssHigh,
    deEssHigh2,
    deEssComp,
    deEssMakeupTrim,
    deEssSum,
    compressor,
    compMakeup,
    presence,
    air,
    saturator,
    saturationWet,
    saturationDry,
    outputTrim,
    reverbSendHighpass,
    reverbSendLowpass,
    reverbConvolver,
    reverbWet,
    delaySend,
    delayHighpass,
    delayLowpass,
    delay,
    vocalBus,
    vocalLevel,
    backingDelay,
    backingLevel,
    masterGain,
    limiter,
    limiterTrim,
  };
}

/** `stems`: whether the vocal and backing are separate — on an already-mixed file the balance
 * sliders don't apply and the mix passes through at unity. */
export function applyMix(chain: VocalChain, s: MixSettings, stems: boolean) {
  chain.player.playbackRate = s.speed / 100;
  chain.backingPlayer.playbackRate = s.speed / 100;
  chain.inputTrim.gain.value = Tone.dbToGain(s.inputTrimDb);
  chain.highpass.frequency.value = 50 + s.lowCut;
  chain.highpass2.frequency.value = 50 + s.lowCut;
  chain.mud.gain.value = -s.mudCutDb;

  for (const f of [chain.deEssLow, chain.deEssLow2, chain.deEssHigh, chain.deEssHigh2]) {
    f.frequency.value = s.deEssHz;
  }
  const deEssGr = deEssGrDb(s.deEss);
  // Gain reduction GR on a peak at level L above threshold T at ratio R: GR = (L − T)(1 − 1/R).
  const deEssThreshold =
    deEssGr > 0 ? s.deEssRefDb + s.inputTrimDb - deEssGr / (1 - 1 / DE_ESS_RATIO) : 0;
  chain.deEssComp.threshold.value = deEssThreshold;
  chain.deEssMakeupTrim.gain.value = Tone.dbToGain(
    -makeupDb(deEssThreshold, DE_ESS_RATIO, DE_ESS_KNEE),
  );

  const compGr = compressionGrDb(s.compression);
  const compThreshold = compGr > 0 ? DETECTOR_LEVEL_DB - compGr / (1 - 1 / COMP_RATIO) : 0;
  chain.compressor.threshold.value = compThreshold;
  // Make back the loud-phrase reduction ("add back what you took off") — in place of the node's
  // own, much larger, built-in makeup.
  chain.compMakeup.gain.value = Tone.dbToGain(
    compGr - makeupDb(compThreshold, COMP_RATIO, COMP_KNEE),
  );
  chain.presence.gain.value = s.presenceDb;
  chain.air.gain.value = s.airDb;
  const sat = (s.warmth / 100) * 0.35;
  chain.saturationWet.gain.value = sat;
  chain.saturationDry.gain.value = 1 - sat * 0.5;
  chain.outputTrim.gain.value = Tone.dbToGain(-s.inputTrimDb);

  chain.reverbWet.gain.value = (s.reverb / 100) * 0.5;
  // Regenerated only when size/pre-delay actually change — and in whatever context is current,
  // so Tone.Offline's render builds its own instead of borrowing the live context's buffer.
  const irKey = `${s.reverbSize}|${s.preDelay}`;
  if (impulseKeys.get(chain) !== irKey) {
    impulseKeys.set(chain, irKey);
    const context = Tone.getContext().rawContext as unknown as BaseAudioContext;
    chain.reverbConvolver.buffer = new Tone.ToneAudioBuffer(
      generateImpulseResponse(context, reverbTailSeconds(s.reverbSize), 3.6, s.preDelay),
    );
  }
  chain.delaySend.gain.value = (s.delay / 100) * 0.5;
  chain.delay.delayTime.value = s.delayTime;

  chain.vocalLevel.gain.value = stems ? s.vocalVolume / 100 : 1;
  chain.backingLevel.gain.value = s.playbackVolume / 100;
  chain.masterGain.gain.value = Tone.dbToGain(s.gainDb);
}

// Both stems always start/stop/seek together on one shared timestamp — they're the same length
// and already aligned (prepareStems), so a single position drives both.
export function startChain(chain: VocalChain, offset: number) {
  const at = Tone.now() + 0.02;
  chain.player.start(at, offset);
  if (chain.backingPlayer.loaded) chain.backingPlayer.start(at, offset);
}

export function stopChain(chain: VocalChain) {
  chain.player.stop();
  if (chain.backingPlayer.loaded) chain.backingPlayer.stop();
}

export function seekChain(chain: VocalChain, offset: number) {
  const at = Tone.now() + 0.02;
  chain.player.seek(offset, at);
  if (chain.backingPlayer.loaded) chain.backingPlayer.seek(offset, at);
}

export function disposeChain(chain: VocalChain) {
  for (const node of Object.values(chain)) node.dispose();
}

const channelsOf = (buffer: AudioBuffer) =>
  Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch));

/**
 * Renders the chain offline — what publish uploads, and what AI mastering measures to check its
 * own result. Works from the live buffers' samples (already gated/pitch-corrected), copied into
 * buffers the offline context owns: Chromium can silently stall an OfflineAudioContext whose
 * source references an AudioBuffer from a different context. Mono, like the published file.
 */
export async function renderMix(
  vocal: AudioBuffer,
  backing: AudioBuffer | null,
  settings: MixSettings,
  stems: boolean,
): Promise<AudioBuffer> {
  const vocalData = channelsOf(vocal);
  const backingData = backing ? channelsOf(backing) : null;
  const duration = vocal.duration / (settings.speed / 100) + 0.3;
  const rendered = await Tone.Offline(
    () => {
      const chain = buildChain();
      chain.player.buffer = Tone.ToneAudioBuffer.fromArray(
        vocalData.length === 1 ? vocalData[0] : vocalData,
      );
      if (backingData) {
        chain.backingPlayer.buffer = Tone.ToneAudioBuffer.fromArray(
          backingData.length === 1 ? backingData[0] : backingData,
        );
      }
      applyMix(chain, settings, stems);
      chain.player.start(0);
      if (backingData) chain.backingPlayer.start(0);
    },
    duration,
    1,
    vocal.sampleRate,
  );
  const out = rendered.get();
  if (!out) throw new Error("renderFailed");
  return out;
}
