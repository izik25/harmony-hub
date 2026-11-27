import * as Tone from "tone";
import { generateImpulseResponse } from "./impulse-response";
import { phraseEndEnvelope } from "./vocal-prep";

/**
 * Studio's vocal chain — one standard lead-vocal chain in the usual order, every stage set from
 * published engineering practice rather than taste:
 *
 *   trim (to −18 dBFS) → high-pass 24dB/oct → mud cut → de-esser (split-band) → compressor
 *   (3.5:1, fast) → leveler (3:1, slow) → presence → air shelf → saturation → trim back → dry
 *   + plate reverb send + delay send + doubler send + delay-throw send → vocal level ─┐
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
  /** 0-100 → 0-6 dB of gain reduction from a second, slow compressor after the first — the
   * two-stage "fast catches the peaks, slow evens out the phrases" chain of a pop lead (an 1176
   * into an LA-2A, classically). */
  leveler: number;
  /** dB at ~3.2kHz, −6..6. */
  presenceDb: number;
  /** dB high shelf from 10kHz, −6..6. */
  airDb: number;
  /** 0-100 → parallel soft saturation blend. */
  warmth: number;
  /** 0-100 → reverb send. */
  reverb: number;
  /** 0-100 → plate RT60 0.6-2.4s (see reverbTailSeconds). */
  reverbSize: number;
  /** Reverb pre-delay, seconds. */
  preDelay: number;
  /** 0-100 → delay send. */
  delay: number;
  /** Delay time, seconds — a dotted eighth of the song's tempo when AI mastering found one. */
  delayTime: number;
  /** 0-100 → doubler send: two copies of the voice micro-pitched ±7 cents and ~15-22ms late,
   * panned left and right — the classic "micro-shift" that makes a lead sound wide and expensive
   * without reading as an effect. */
  width: number;
  /** 0-100 → delay-throw send: an echo caught only on the last word of each sung line (see
   * phraseEndEnvelope), repeating into the pause after it. */
  throws: number;
  /** Delay-throw time, seconds — a quarter note of the song's tempo when AI mastering found one. */
  throwTime: number;
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
  // Off until AI mastering (or the user) turns them on, so a take that hasn't been mastered
  // sounds exactly as before.
  leveler: 0,
  width: 0,
  throws: 0,
  throwTime: 0.5,
  gainDb: 0,
  // 115/95 match record.tsx's initial auto-mix.
  vocalVolume: 115,
  playbackVolume: 95,
};

export const reverbTailSeconds = (size: number) => 0.6 + (size / 100) * 1.8;
export const compressionGrDb = (compression: number) => (compression / 100) * 9;
export const levelerGrDb = (leveler: number) => (leveler / 100) * 6;
export const deEssGrDb = (deEss: number) => (deEss / 100) * 8;

const COMP_RATIO = 3.5;
const LEVEL_RATIO = 3;
const LEVEL_KNEE = 10;
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

type Doubler = {
  send: Tone.Gain;
  highpass: Tone.Filter;
  left: Tone.PitchShift;
  right: Tone.PitchShift;
  panLeft: Tone.Panner;
  panRight: Tone.Panner;
  wet: Tone.Gain;
};

/** Doubler: ±7 cents (0.07 semitones), each on a 30ms pitch-shift window, so the copies run ~15ms
 * (left) and ~22ms (right) behind the voice — inside classic ADT's 10-25ms, short of where they'd
 * read as a slap. High-passed so the doubles add width, not low-end mud. */
function buildDoubler(): Doubler {
  const send = new Tone.Gain(0);
  const highpass = new Tone.Filter({ type: "highpass", frequency: 250 });
  const left = new Tone.PitchShift({ pitch: 0.07, windowSize: 0.03, delayTime: 0, wet: 1 });
  const right = new Tone.PitchShift({ pitch: -0.07, windowSize: 0.03, delayTime: 0.007, wet: 1 });
  const panLeft = new Tone.Panner(-0.7);
  const panRight = new Tone.Panner(0.7);
  const wet = new Tone.Gain(1);
  send.connect(highpass);
  highpass.fan(left, right);
  left.chain(panLeft, wet);
  right.chain(panRight, wet);
  return { send, highpass, left, right, panLeft, panRight, wet };
}

type ThrowFx = {
  /** Plays phraseEndEnvelope on the vocal's timeline, into the send's gain. */
  envelope: Tone.Player;
  level: Tone.Gain;
  send: Tone.Gain;
  highpass: Tone.Filter;
  lowpass: Tone.Filter;
  delay: Tone.FeedbackDelay;
  toReverb: Tone.Gain;
};

/** Delay throw: the send's gain is 0 except where the envelope player opens it (the end of each
 * line). Dark and band-limited like a tape echo, with more feedback than the ambience delay so the
 * word repeats into the pause; a little of it goes into the plate so the repeats sit in the same
 * space as the voice. */
function buildThrowFx(): ThrowFx {
  const envelope = new Tone.Player();
  const level = new Tone.Gain(0);
  const send = new Tone.Gain(0);
  const highpass = new Tone.Filter({ type: "highpass", frequency: 300 });
  const lowpass = new Tone.Filter({ type: "lowpass", frequency: 3500 });
  const delay = new Tone.FeedbackDelay({ delayTime: 0.5, feedback: 0.35, maxDelay: 2, wet: 1 });
  const toReverb = new Tone.Gain(0.3);
  envelope.connect(level);
  level.connect(send.gain);
  send.chain(highpass, lowpass, delay, toReverb);
  return { envelope, level, send, highpass, lowpass, delay, toReverb };
}

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
  leveler: Tone.Compressor;
  levelerMakeup: Tone.Gain;
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
  /** null when built without it — see buildChain. */
  doubler: Doubler | null;
  throwFx: ThrowFx | null;
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

export function buildChain(options: { doubler?: boolean; throws?: boolean } = {}): VocalChain {
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
  // The slow stage: an opto-style leveler — a 30ms attack leaves transients to the fast compressor
  // above, a 500ms release rides the phrase rather than the syllable, and a wide knee keeps it
  // gentle.
  const leveler = new Tone.Compressor({
    ratio: LEVEL_RATIO,
    attack: 0.03,
    release: 0.5,
    knee: LEVEL_KNEE,
    threshold: 0,
  });
  const levelerMakeup = new Tone.Gain(1);
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

  // The doubler and throws run nodes (pitch-shift LFOs, a feedback delay) even with their sends at
  // zero — over twice the render time on its own — so an offline render that doesn't use them
  // leaves them out. The live chain always has them, for the sliders.
  const doubler = options.doubler === false ? null : buildDoubler();
  const throwFx = options.throws === false ? null : buildThrowFx();

  const vocalBus = new Tone.Gain(1);
  const vocalLevel = new Tone.Gain(1);
  // The vocal path runs through three compressors' lookahead (de-esser, compressor, leveler);
  // delaying the backing by the same keeps the take exactly on the beat it was sung to.
  const backingDelay = new Tone.Delay(latency * 3);
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
  deEssSum.chain(compressor, compMakeup, leveler, levelerMakeup, presence, air);
  air.fan(saturationDry, saturator);
  saturator.connect(saturationWet);
  saturationDry.connect(outputTrim);
  saturationWet.connect(outputTrim);
  outputTrim.fan(vocalBus, reverbSendHighpass, delaySend);
  reverbSendHighpass.chain(reverbSendLowpass, reverbConvolver, reverbWet, vocalBus);
  delaySend.chain(delayHighpass, delayLowpass, delay, vocalBus);
  if (doubler) {
    outputTrim.connect(doubler.send);
    doubler.wet.connect(vocalBus);
  }
  if (throwFx) {
    outputTrim.connect(throwFx.send);
    throwFx.delay.connect(vocalBus);
    throwFx.toReverb.connect(reverbSendHighpass);
  }
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
    leveler,
    levelerMakeup,
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
    doubler,
    throwFx,
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
  if (chain.throwFx) chain.throwFx.envelope.playbackRate = s.speed / 100;
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
  const levelGr = levelerGrDb(s.leveler);
  const levelThreshold = levelGr > 0 ? DETECTOR_LEVEL_DB - levelGr / (1 - 1 / LEVEL_RATIO) : 0;
  chain.leveler.threshold.value = levelThreshold;
  chain.levelerMakeup.gain.value = Tone.dbToGain(
    levelGr - makeupDb(levelThreshold, LEVEL_RATIO, LEVEL_KNEE),
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
      generateImpulseResponse(context, reverbTailSeconds(s.reverbSize), s.preDelay),
    );
  }
  chain.delaySend.gain.value = (s.delay / 100) * 0.5;
  chain.delay.delayTime.value = s.delayTime;
  if (chain.doubler) chain.doubler.send.gain.value = (s.width / 100) * 0.5;
  if (chain.throwFx) {
    chain.throwFx.level.gain.value = (s.throws / 100) * 0.6;
    chain.throwFx.delay.delayTime.value = s.throwTime;
  }

  chain.vocalLevel.gain.value = stems ? s.vocalVolume / 100 : 1;
  chain.backingLevel.gain.value = s.playbackVolume / 100;
  chain.masterGain.gain.value = Tone.dbToGain(s.gainDb);
}

// Both stems always start/stop/seek together on one shared timestamp — they're the same length
// and already aligned (prepareStems), so a single position drives both. Start and seek return
// that timestamp (AudioContext time): when `offset` starts playing, outputLatencySeconds() before
// it reaches the speaker.
export function startChain(chain: VocalChain, offset: number): number {
  const at = Tone.now() + 0.02;
  chain.player.start(at, offset);
  if (chain.backingPlayer.loaded) chain.backingPlayer.start(at, offset);
  if (chain.throwFx?.envelope.loaded) chain.throwFx.envelope.start(at, offset);
  return at;
}

export function stopChain(chain: VocalChain) {
  chain.player.stop();
  if (chain.backingPlayer.loaded) chain.backingPlayer.stop();
  if (chain.throwFx?.envelope.loaded) chain.throwFx.envelope.stop();
}

/** Envelope sample rate: the envelope only moves over tens of milliseconds, so a low rate keeps a
 * 3-minute take's envelope a few MB instead of tens. */
const ENVELOPE_RATE = 8000;

/** Loads the delay-throw envelope (see phraseEndEnvelope) for `vocal` into the chain — on its own
 * player, which startChain/seekChain keep on the vocal's timeline. */
export function setThrowEnvelope(chain: VocalChain, vocal: AudioBuffer) {
  if (!chain.throwFx) return;
  const { envelope } = phraseEndEnvelope(vocal.getChannelData(0), vocal.sampleRate, ENVELOPE_RATE);
  const context = Tone.getContext().rawContext as unknown as BaseAudioContext;
  let buffer: AudioBuffer;
  try {
    buffer = context.createBuffer(1, envelope.length, ENVELOPE_RATE);
    buffer.getChannelData(0).set(envelope);
  } catch {
    // A browser that won't make a buffer this far under its own rate: hold each value up to it.
    const rate = context.sampleRate;
    const length = Math.ceil((envelope.length / ENVELOPE_RATE) * rate);
    buffer = context.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = envelope[Math.min(envelope.length - 1, Math.floor((i / rate) * ENVELOPE_RATE))];
    }
  }
  chain.throwFx.envelope.buffer = new Tone.ToneAudioBuffer(buffer);
}

/** A seek is a stop and a fresh start at the same instant, not Tone.Player.seek: that swaps the
 * source but leaves the player's original end time in its state timeline, so after scrubbing back
 * the player reports "stopped" once that time passes while it's still sounding — later seeks and
 * stops are then silently ignored, and the next play starts a second copy over the first. Only
 * for a chain that's playing — a paused one just starts from the new position on play. */
export function seekChain(chain: VocalChain, offset: number): number {
  const at = Tone.now() + 0.02;
  for (const player of [chain.player, chain.backingPlayer, chain.throwFx?.envelope]) {
    if (!player?.loaded) continue;
    player.stop(at);
    player.start(at, offset);
  }
  return at;
}

/** Seconds between the context scheduling a sample and it leaving the speaker. */
export function outputLatencySeconds(): number {
  const raw = Tone.getContext().rawContext as unknown as {
    baseLatency?: number;
    outputLatency?: number;
  };
  return (raw.baseLatency ?? 0) + (raw.outputLatency ?? 0);
}

export function disposeChain(chain: VocalChain) {
  for (const value of Object.values(chain)) {
    if (value instanceof Tone.ToneAudioNode) value.dispose();
    else if (value) for (const node of Object.values(value)) node.dispose();
  }
}

const channelsOf = (buffer: AudioBuffer) =>
  Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch));

/**
 * Renders the chain offline — what publish uploads, and what AI mastering measures to check its
 * own result. Works from the live buffers' samples (already gated/pitch-corrected), copied into
 * buffers the offline context owns: Chromium can silently stall an OfflineAudioContext whose
 * source references an AudioBuffer from a different context. Stereo, exactly as Studio plays it
 * live: the voice in the center, the plate spread across both sides, the backing at its own width.
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
      const chain = buildChain({ doubler: settings.width > 0, throws: settings.throws > 0 });
      chain.player.buffer = Tone.ToneAudioBuffer.fromArray(
        vocalData.length === 1 ? vocalData[0] : vocalData,
      );
      if (backingData) {
        chain.backingPlayer.buffer = Tone.ToneAudioBuffer.fromArray(
          backingData.length === 1 ? backingData[0] : backingData,
        );
      }
      const vocalBuffer = chain.player.buffer.get();
      if (vocalBuffer) setThrowEnvelope(chain, vocalBuffer);
      applyMix(chain, settings, stems);
      chain.player.start(0);
      if (backingData) chain.backingPlayer.start(0);
      if (chain.throwFx?.envelope.loaded) chain.throwFx.envelope.start(0);
    },
    duration,
    2,
    vocal.sampleRate,
  );
  const out = rendered.get();
  if (!out) throw new Error("renderFailed");
  return out;
}
