// Real pitch detection + correction. This is the piece AI Mastering was missing: the "autotune"
// slider in studio.tsx drives a live Tone.PitchShift, which can only apply one fixed shift to the
// whole signal — there's nothing in this app that ever measured what pitch was actually sung, so
// that slider defaults to (and stays at) 0 rather than mangling every take with a shift that has
// no idea what it's correcting toward (see the comment by pitchRef in studio.tsx). This module
// instead measures the sung pitch per grain with autocorrelation and, where it's confidently
// voiced, destructively resamples that grain toward the nearest chromatic note — the same
// "mutate the actual samples" approach applyNoiseGate uses for noise cleanup in mix-recording.ts.
//
// A first version of this detected and corrected each grain independently and it made takes sound
// worse, not better: per-frame autocorrelation noise (a few cents of jitter is normal even on a
// dead-steady note, plus the occasional octave error) turned into a different resample ratio on
// almost every grain, and since each grain gets resampled independently, a changing ratio between
// overlapping grains is a phase discontinuity at every grain boundary — audible as robotic
// warble/flutter, worst exactly on sustained notes and quiet passages where it was most noticeable.
// The fix is the same one real pitch correction uses ("retune speed"): detect the whole take's
// pitch track first, median-filter it to reject outliers, then exponentially smooth the correction
// ratio over time so it eases into a note instead of snapping grain-to-grain — see
// medianFilterPitch and smoothRatioTrack below.

const MIN_HZ = 80; // below typical low male singing range; also keeps the autocorrelation lag search short
const MAX_HZ = 900; // above typical high female/falsetto singing range
const SILENCE_RMS = 0.01; // ~-40dBFS — frames this quiet are breath/room noise, not a note to correct
const CONFIDENCE_MIN = 0.5; // normalized autocorrelation peak below this isn't a real periodic note —
// raised from a looser 0.35 specifically because low-confidence hits on consonants/breath were
// exactly what fed spurious ratio jumps into the (now-fixed) warble problem above

function hannWindow(size: number): Float32Array {
  // Periodic (denominator = size, not size-1) form: overlap-adding this at hop = size/2 sums to an
  // exact constant, so the reconstruction below never needs a separate normalization pass.
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}

/**
 * Autocorrelation pitch detection with a decimated coarse pass (search a downsampled copy first,
 * then refine only the few lags around the winner at full resolution) — a plain full-resolution
 * search over the whole voice range costs enough per frame that scanning a multi-minute take
 * frame-by-frame becomes seconds-to-minutes of work; this keeps it seconds at most. Parabolic
 * interpolation around the best lag gives sub-sample precision, and a confidence check (best
 * correlation normalized against the frame's own energy) rejects noise/consonants that have no
 * real periodicity to lock onto.
 */
function autocorrelate(
  frame: Float32Array | Float64Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
): number | null {
  const n = frame.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i];
  mean /= n;

  const centered = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    centered[i] = frame[i] - mean;
    energy += centered[i] * centered[i];
  }
  const rms = Math.sqrt(energy / n);
  if (rms < SILENCE_RMS) return null;

  const minLag = Math.max(1, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(n - 2, Math.floor(sampleRate / minHz));
  if (maxLag <= minLag) return null;

  const corrAt = (lag: number) => {
    let c = 0;
    for (let i = 0; i < n - lag; i++) c += centered[i] * centered[i + lag];
    return c;
  };

  // Coarse pass: every 4th sample, roughly a 16x cheaper search to narrow down the lag.
  const decim = 4;
  const decimLen = Math.floor(n / decim);
  const decimated = new Float32Array(decimLen);
  for (let i = 0; i < decimLen; i++) decimated[i] = centered[i * decim];
  const decimMinLag = Math.max(1, Math.floor(minLag / decim));
  const decimMaxLag = Math.max(decimMinLag + 1, Math.floor(maxLag / decim));

  let bestDecimLag = -1;
  let bestDecimCorr = 0;
  for (let lag = decimMinLag; lag <= decimMaxLag; lag++) {
    let c = 0;
    for (let i = 0; i < decimLen - lag; i++) c += decimated[i] * decimated[i + lag];
    if (c > bestDecimCorr) {
      bestDecimCorr = c;
      bestDecimLag = lag;
    }
  }
  if (bestDecimLag <= 0) return null;

  // Fine pass: only the handful of full-resolution lags around the coarse winner.
  const centerLag = bestDecimLag * decim;
  const radius = decim * 2;
  const fineMin = Math.max(minLag, centerLag - radius);
  const fineMax = Math.min(maxLag, centerLag + radius);

  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = fineMin; lag <= fineMax; lag++) {
    const c = corrAt(lag);
    if (c > bestCorr) {
      bestCorr = c;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return null;

  let energyLag = 0;
  for (let i = 0; i < n - bestLag; i++) energyLag += centered[i + bestLag] * centered[i + bestLag];
  const denom = Math.sqrt(energy * energyLag);
  const confidence = denom > 0 ? bestCorr / denom : 0;
  if (confidence < CONFIDENCE_MIN) return null; // not confidently periodic — treat as unvoiced rather than guess

  const cLeft = bestLag > fineMin ? corrAt(bestLag - 1) : bestCorr;
  const cRight = bestLag < fineMax ? corrAt(bestLag + 1) : bestCorr;
  const denom2 = cLeft - 2 * bestCorr + cRight;
  const shift = denom2 !== 0 ? (0.5 * (cLeft - cRight)) / denom2 : 0;
  const refinedLag = bestLag + Math.max(-1, Math.min(1, shift));

  return sampleRate / refinedLag;
}

/** Nearest equal-tempered chromatic note to a detected frequency — no key/scale detection, just
 * "which of the 12 semitones is this closest to," which is what plain autotune snaps to. */
export function nearestNoteFreq(freq: number, referenceA4 = 440): number {
  const semitones = 12 * Math.log2(freq / referenceA4);
  const nearest = Math.round(semitones);
  return referenceA4 * 2 ** (nearest / 12);
}

function frameSizeFor(sampleRate: number): number {
  return Math.max(512, Math.floor(sampleRate * 0.023)); // ~23ms — a couple of periods even at 80Hz
}

/** Runs autocorrelate across the whole channel on a fixed hop, once — both analyzePitch and
 * applyPitchCorrection need this same raw per-frame pitch track before they can do anything else
 * with it (measure deviation, or median-filter + smooth it for correction). */
function detectPitchTrack(
  data: Float32Array,
  sampleRate: number,
  frameSize: number,
  hop: number,
): (number | null)[] {
  const track: (number | null)[] = [];
  for (let pos = 0; pos + frameSize <= data.length; pos += hop) {
    track.push(autocorrelate(data.subarray(pos, pos + frameSize), sampleRate, MIN_HZ, MAX_HZ));
  }
  return track;
}

/**
 * Median-of-up-to-5 filter over a raw pitch track. Rejects the classic autocorrelation failure
 * mode — a single frame locking onto half or double the true period (an octave error) — as the
 * outlier it is, rather than as real pitch content that the correction below would otherwise try
 * to snap a grain toward a wildly wrong note over. A position only gets a filtered value when at
 * least 3 of its (up to 5) neighbors are voiced; thin/isolated voiced blips stay null rather than
 * getting invented pitch content from a mostly-silent neighborhood.
 */
function medianFilterPitch(track: (number | null)[]): (number | null)[] {
  const n = track.length;
  const out: (number | null)[] = new Array(n).fill(null);
  const radius = 2;
  for (let i = 0; i < n; i++) {
    const windowVals: number[] = [];
    for (let j = Math.max(0, i - radius); j <= Math.min(n - 1, i + radius); j++) {
      const v = track[j];
      if (v != null) windowVals.push(v);
    }
    if (windowVals.length < 3) continue;
    windowVals.sort((a, b) => a - b);
    out[i] = windowVals[Math.floor(windowVals.length / 2)];
  }
  return out;
}

/**
 * Exponential smoothing of the per-frame correction ratio across time — the "retune speed" real
 * pitch correction needs. Without it, the ratio can still take a real step (a genuine note change,
 * or easing in/out of a voiced region) between adjacent grains, and since the grains below are
 * resampled and overlap-added independently, any step in ratio is a phase discontinuity at that
 * grain boundary — audible as a click or warble even though the underlying pitch track itself is
 * now clean. Smoothing lets the correction slide into place over a few grains instead, which is
 * also just how a human ear expects pitch correction to sound rather than a hard robotic snap.
 */
function smoothRatioTrack(ratios: number[], hopMs: number, timeConstantMs = 45): number[] {
  const alpha = 1 - Math.exp(-hopMs / timeConstantMs);
  const out = new Array<number>(ratios.length);
  let state = 1;
  for (let i = 0; i < ratios.length; i++) {
    state += (ratios[i] - state) * alpha;
    out[i] = state;
  }
  return out;
}

export type PitchProfile = {
  /** Fraction of analyzed frames that carried a confident, median-filtered pitch — low for
   * spoken-word or mostly-consonant takes, where there's little sustained pitch worth correcting. */
  voicedRatio: number;
  /** Average absolute distance from the nearest chromatic note across voiced frames, in cents
   * (100 cents = 1 semitone). Near 0 for an already in-tune take, larger for one that drifts. */
  avgAbsCents: number;
};

/**
 * Detection-only pass (no resynthesis) so AI Mastering can measure how far off-pitch a take
 * actually is before paying for the full correction pass in applyPitchCorrection — an already
 * in-tune take should be left alone rather than run through resampling for no audible gain. Uses
 * the same median-filtered track applyPitchCorrection corrects toward, so this measurement isn't
 * inflated by single-frame detection noise that the correction itself would never act on.
 */
export function analyzePitch(buffer: AudioBuffer, referenceA4 = 440): PitchProfile {
  const data = buffer.getChannelData(0);
  const frameSize = frameSizeFor(buffer.sampleRate);
  const hop = Math.floor(frameSize / 2);
  const filtered = medianFilterPitch(detectPitchTrack(data, buffer.sampleRate, frameSize, hop));

  let voiced = 0;
  let centsSum = 0;
  for (const f0 of filtered) {
    if (f0 == null) continue;
    voiced++;
    const target = nearestNoteFreq(f0, referenceA4);
    centsSum += Math.abs(1200 * Math.log2(f0 / target));
  }
  return {
    voicedRatio: filtered.length > 0 ? voiced / filtered.length : 0,
    avgAbsCents: voiced > 0 ? centsSum / voiced : 0,
  };
}

function sampleAt(data: Float32Array, x: number): number {
  if (x < 0 || x >= data.length) return 0;
  const i0 = Math.floor(x);
  if (i0 >= data.length - 1) return data[i0];
  const frac = x - i0;
  return data[i0] * (1 - frac) + data[i0 + 1] * frac;
}

/**
 * Destructively retunes the buffer toward the nearest chromatic note: detect the sung pitch track
 * for the whole channel, median-filter it (rejects octave errors), turn it into a per-frame
 * correction ratio blended by `strength` (0 = untouched, 1 = fully snapped), smooth that ratio over
 * time (retune speed — see smoothRatioTrack), then resample each ~23ms grain by its smoothed ratio
 * and overlap-add it back with a Hann window at 50% hop. No FFT, cheap enough to run synchronously
 * on click. Grains with no confident pitch (breaths, consonants, room tone) pull the ratio back
 * toward 1 (smoothed, not instant) rather than being quantized to a note that was never sung.
 */
export function applyPitchCorrection(
  buffer: AudioBuffer,
  strength: number,
  referenceA4 = 440,
): void {
  const clampedStrength = Math.min(1, Math.max(0, strength));
  if (clampedStrength <= 0) return;

  const frameSize = frameSizeFor(buffer.sampleRate);
  const hop = Math.floor(frameSize / 2);
  const hopMs = (hop / buffer.sampleRate) * 1000;
  const window = hannWindow(frameSize);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const n = input.length;

    const filtered = medianFilterPitch(detectPitchTrack(input, buffer.sampleRate, frameSize, hop));
    const rawRatios = filtered.map((f0) => {
      if (f0 == null) return 1;
      const target = nearestNoteFreq(f0, referenceA4);
      return 1 + (target / f0 - 1) * clampedStrength;
    });
    const smoothed = smoothRatioTrack(rawRatios, hopMs).map((r) =>
      Math.min(1.3, Math.max(0.75, r)),
    );

    const output = new Float32Array(n);
    let frameIdx = 0;
    for (let pos = 0; pos < n; pos += hop, frameIdx++) {
      const ratio = smoothed[frameIdx] ?? 1;
      const center = pos + frameSize / 2;
      for (let k = 0; k < frameSize; k++) {
        const outIdx = pos + k;
        if (outIdx >= n) break;
        const srcPos = center + (k - frameSize / 2) * ratio;
        output[outIdx] += sampleAt(input, srcPos) * window[k];
      }
    }

    input.set(output);
  }
}
