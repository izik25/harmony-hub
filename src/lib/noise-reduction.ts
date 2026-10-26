/**
 * Offline spectral noise reduction for a recorded vocal take — the "learn the room, then take it
 * out everywhere" pass a studio runs on a phone recording, not just a gate between phrases.
 * The gate in mix-recording.ts can only turn the gaps down; the room (fan, AC, traffic hiss,
 * the phone's own self-noise) is still sitting under every sung word. This removes it from under
 * the voice too, frequency by frequency:
 *
 * - STFT (1024-point, 50% overlap, sine window — perfect reconstruction when nothing is changed).
 * - A per-bin noise profile learned from the whole take: the quietest tenth of each frequency
 *   bin's (smoothed) power over the entire recording, scaled up to the noise's mean. The gaps
 *   between phrases, and the bins between a voice's harmonics, are what that quiet tenth is made
 *   of, so it needs no silent stretch of its own. Not a sliding minimum: that's the textbook choice
 *   for speech, but it assumes a pause every second or so and takes a held sung note for noise.
 * - Decision-directed Wiener gain (Ephraim-Malah): bins well above the noise pass untouched, bins
 *   at the noise level come down to the floor. Smoothing the SNR estimate across frames is what
 *   keeps this from leaving "musical noise" (twinkling leftover tones) behind.
 * - Floored at -20dB rather than removing noise completely: pushing further is where a voice
 *   starts sounding processed/underwater, and the gate downstream already dips the gaps further.
 *
 * Runs in a Web Worker (see noise-reduction.worker.ts and reduceNoiseOffThread) so a long take
 * doesn't freeze the page while it's processed.
 */

const FFT_SIZE = 1024;
const HOP = FFT_SIZE / 2;
const BINS = FFT_SIZE / 2 + 1;
/** Frame-to-frame power smoothing for the noise profile. */
const POWER_SMOOTHING = 0.8;
const NOISE_PERCENTILE = 0.1;
/** The 10th percentile of smoothed noise power sits this far under its mean (calibrated on
 * white and pink noise). */
const PERCENTILE_BIAS = 1.6;
/** Histogram the profile is read from — 0.25dB steps over -200..+20dB, per bin. */
const HIST_MIN_DB = -200;
const HIST_STEP_DB = 0.25;
const HIST_SIZE = 880;
/** Decision-directed smoothing of the a-priori SNR — the musical-noise suppressor. */
const DD_ALPHA = 0.98;
const GAIN_FLOOR = 0.1; // -20dB

function createFft(n: number) {
  const levels = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  /** In-place radix-2 FFT; `inverse` flips the twiddle sign (scaling is left to the caller). */
  return (re: Float64Array, im: Float64Array, inverse: boolean) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step];
          const wi = sign * sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  };
}

/** Returns a noise-reduced copy of `input` (mono samples), the same length and alignment. */
export function reduceNoise(input: Float32Array): Float32Array<ArrayBuffer> {
  const fft = createFft(FFT_SIZE);
  const window = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = Math.sin((Math.PI * (i + 0.5)) / FFT_SIZE);

  // Padded by one frame at both ends so the first and last samples get full overlap-add coverage.
  const padded = new Float32Array(input.length + 2 * FFT_SIZE);
  padded.set(input, FFT_SIZE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const analyze = (start: number) => {
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = padded[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im, false);
  };

  // Pass 1: the take's own noise profile.
  const hist = new Uint32Array(BINS * HIST_SIZE);
  const smoothed = new Float64Array(BINS);
  let frames = 0;
  for (let start = 0; start + FFT_SIZE <= padded.length; start += HOP) {
    analyze(start);
    for (let k = 0; k < BINS; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      smoothed[k] =
        frames === 0 ? power : POWER_SMOOTHING * smoothed[k] + (1 - POWER_SMOOTHING) * power;
      const db = 10 * Math.log10(smoothed[k] + 1e-20);
      const slot = Math.min(
        HIST_SIZE - 1,
        Math.max(0, Math.floor((db - HIST_MIN_DB) / HIST_STEP_DB)),
      );
      hist[k * HIST_SIZE + slot]++;
    }
    frames++;
  }
  const noise = new Float64Array(BINS);
  const rank = Math.max(1, Math.floor(frames * NOISE_PERCENTILE));
  for (let k = 0; k < BINS; k++) {
    let count = 0;
    let slot = 0;
    while (slot < HIST_SIZE - 1 && (count += hist[k * HIST_SIZE + slot]) < rank) slot++;
    const db = HIST_MIN_DB + (slot + 0.5) * HIST_STEP_DB;
    noise[k] = Math.max(10 ** (db / 10) * PERCENTILE_BIAS, 1e-20);
  }

  // Pass 2: apply.
  const out = new Float32Array(padded.length);
  const prevClean = new Float64Array(BINS);
  const gain = new Float64Array(BINS);
  let first = true;
  for (let start = 0; start + FFT_SIZE <= padded.length; start += HOP) {
    analyze(start);
    for (let k = 0; k < BINS; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      const post = power / noise[k];
      const prio = first
        ? Math.max(post - 1, 0)
        : DD_ALPHA * (prevClean[k] / noise[k]) + (1 - DD_ALPHA) * Math.max(post - 1, 0);
      const g = Math.max(prio / (1 + prio), GAIN_FLOOR);
      gain[k] = g;
      prevClean[k] = g * g * power;
    }
    first = false;

    // A light smear across neighbouring bins, so a single bin can't flicker on its own.
    for (let k = 0; k < BINS; k++) {
      const g =
        0.25 * gain[Math.max(0, k - 1)] + 0.5 * gain[k] + 0.25 * gain[Math.min(BINS - 1, k + 1)];
      re[k] *= g;
      im[k] *= g;
      if (k > 0 && k < FFT_SIZE / 2) {
        re[FFT_SIZE - k] *= g;
        im[FFT_SIZE - k] *= g;
      }
    }
    fft(re, im, true);
    for (let i = 0; i < FFT_SIZE; i++) out[start + i] += (re[i] / FFT_SIZE) * window[i];
  }
  return out.slice(FFT_SIZE, FFT_SIZE + input.length);
}

/**
 * reduceNoise on a worker thread; falls back to running it right here if a worker can't be
 * started (it's the same function either way, just whether the page stays responsive meanwhile).
 */
export function reduceNoiseOffThread(input: Float32Array): Promise<Float32Array<ArrayBuffer>> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./noise-reduction.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return Promise.resolve(reduceNoise(input));
  }
  return new Promise<Float32Array<ArrayBuffer>>((resolve) => {
    worker.onmessage = (e: MessageEvent<Float32Array<ArrayBuffer>>) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(reduceNoise(input));
    };
    worker.postMessage(input);
  });
}
