/**
 * Finds how far behind the clean backing track the take actually runs, by locating the backing
 * track's own bleed inside the mic recording.
 *
 * MIC_CONSTRAINTS (record.tsx) deliberately leaves echoCancellation off, so on a phone speaker the
 * backing track leaks straight into the mic — and it arrives there late by the full round trip
 * (output latency + input latency + however far apart video.play() and the recorder really
 * started). processRecording then mixed that late, leaked copy back in next to the clean backing
 * track started at exactly t=0: two copies of the same music 100-300ms apart is a textbook
 * slapback echo, and it's what read as "too much echo / too studio-y" on speaker takes even with
 * reverb turned all the way off. The singer is late by the exact same round trip (they sang to
 * what they heard), so delaying the clean backing by the measured bleed delay fixes both at once:
 * the leaked copy lands on top of the clean one instead of trailing it, and the vocal lands on
 * the beat. The vocal itself is never moved, so a camera take's lip-sync is untouched.
 *
 * Plain cross-correlation can't find the bleed under a voice that's 20dB louder than it, nor
 * separate the true lag from the music's own beat-to-beat self-similarity. GCC-PHAT (generalized
 * cross-correlation with phase transform — the standard time-delay estimator) whitens each frame's
 * cross-spectrum so every frequency votes equally on the lag, then sums across ~100 frames: the
 * voice is uncorrelated with the backing and averages out, while the bleed lines up at the same
 * lag every frame and builds a sharp peak.
 *
 * Headphone takes have no bleed to find; the peak then doesn't stand out from the rest of the
 * curve and this returns null, leaving the mix exactly as it was before.
 */

const ANALYSIS_RATE = 8000;
const ANALYZE_SECONDS = 30;
const FRAME = 4096; // ~0.5s at ANALYSIS_RATE
const FFT_SIZE = 16384; // holds FRAME + the whole lag range with no circular wrap
/** The recorder can start slightly before playback is actually audible, putting the bleed earlier
 * than expected — rare and small, so the range is lopsided toward "late". */
const MAX_EARLY_SECONDS = 0.25;
const MAX_LATE_SECONDS = 0.8;
/** How far (in standard deviations) the summed GCC-PHAT peak has to stand above the rest of the
 * lag curve before it's trusted as real bleed rather than coincidental similarity. */
const MIN_PEAK_Z = 9;

/** Block-average decimation — doubles as a crude anti-alias lowpass. Indices outside the source
 * read as silence. */
function decimate(data: Float32Array, startSample: number, outLength: number, factor: number) {
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const s0 = startSample + i * factor;
    let sum = 0;
    for (let j = 0; j < factor; j++) {
      const idx = s0 + j;
      if (idx >= 0 && idx < data.length) sum += data[idx];
    }
    out[i] = sum / factor;
  }
  return out;
}

/** In-place iterative radix-2 FFT; `inverse` skips the 1/N scale (irrelevant for peak picking). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function energy(x: Float32Array) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return s;
}

/**
 * Returns the bleed delay in seconds (positive = backing has to start that much later in the mix
 * than it used to), or null when there's no confident bleed to align on.
 */
export function estimateBleedDelaySeconds(
  mic: Float32Array,
  micRate: number,
  backing: Float32Array,
  backingRate: number,
  backingStartOffsetSeconds: number,
): number | null {
  if (micRate !== backingRate) return null; // both come out of one decode context; never expected
  const factor = Math.max(1, Math.round(micRate / ANALYSIS_RATE));
  const rate = micRate / factor;
  const maxLag = Math.ceil((MAX_EARLY_SECONDS + MAX_LATE_SECONDS) * rate);
  if (FRAME + maxLag > FFT_SIZE) return null;

  const micLen = Math.floor(Math.min(ANALYZE_SECONDS, mic.length / micRate) * rate);
  if (micLen < FRAME * 4) return null;
  const m = decimate(mic, 0, micLen, factor);
  // b[j] is backing-track time (offset - MAX_LATE + j/rate). A bleed delay d puts mic time t on
  // backing time offset + t - d, i.e. at lag k = (MAX_LATE - d) * rate into b.
  const b = decimate(
    backing,
    Math.round((backingStartOffsetSeconds - MAX_LATE_SECONDS) * micRate),
    micLen + maxLag,
    factor,
  );

  const sum = new Float64Array(maxLag + 1);
  const mRe = new Float64Array(FFT_SIZE);
  const mIm = new Float64Array(FFT_SIZE);
  const bRe = new Float64Array(FFT_SIZE);
  const bIm = new Float64Array(FFT_SIZE);
  let frames = 0;
  for (let start = 0; start + FRAME <= micLen; start += FRAME / 2) {
    const mFrame = m.subarray(start, start + FRAME);
    const bFrame = b.subarray(start, start + FRAME + maxLag);
    // A silent stretch (intro before the backing starts, a mic dropout) contributes only noise.
    if (energy(mFrame) < 1e-6 || energy(bFrame) < 1e-6) continue;
    mRe.fill(0);
    mIm.fill(0);
    bRe.fill(0);
    bIm.fill(0);
    for (let i = 0; i < FRAME; i++) {
      // Hann window keeps frame edges from smearing every lag with the same broadband click.
      mRe[i] = mFrame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
    }
    bRe.set(bFrame);
    fft(mRe, mIm, false);
    fft(bRe, bIm, false);
    // conj(M) * B, normalized to unit magnitude (the "phase transform"); the small floor keeps
    // empty bins from being blown up into pure noise.
    let magSum = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const re = mRe[i] * bRe[i] + mIm[i] * bIm[i];
      const im = mRe[i] * bIm[i] - mIm[i] * bRe[i];
      mRe[i] = re;
      mIm[i] = im;
      magSum += Math.hypot(re, im);
    }
    const floor = (magSum / FFT_SIZE) * 1e-3;
    for (let i = 0; i < FFT_SIZE; i++) {
      const mag = Math.hypot(mRe[i], mIm[i]) + floor;
      mRe[i] /= mag;
      mIm[i] /= mag;
    }
    fft(mRe, mIm, true);
    for (let k = 0; k <= maxLag; k++) sum[k] += mRe[k];
    frames++;
  }
  if (frames < 8) return null;

  let bestK = 0;
  for (let k = 1; k <= maxLag; k++) if (sum[k] > sum[bestK]) bestK = k;
  let mean = 0;
  for (let k = 0; k <= maxLag; k++) mean += sum[k];
  mean /= maxLag + 1;
  let variance = 0;
  for (let k = 0; k <= maxLag; k++) variance += (sum[k] - mean) ** 2;
  const std = Math.sqrt(variance / (maxLag + 1));
  if (!(std > 0) || (sum[bestK] - mean) / std < MIN_PEAK_Z) return null;

  // Parabolic interpolation between neighbouring lags — at 8kHz alone the residual (up to
  // ±0.06ms) is still enough to comb-filter the leaked and clean copies against each other.
  let frac = 0;
  if (bestK > 0 && bestK < maxLag) {
    const a = sum[bestK - 1];
    const c = sum[bestK + 1];
    const denom = a - 2 * sum[bestK] + c;
    if (denom < 0) frac = (0.5 * (a - c)) / denom;
  }
  return MAX_LATE_SECONDS - (bestK + frac) / rate;
}
