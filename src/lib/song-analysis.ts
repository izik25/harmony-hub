/**
 * The "understand the song" pass behind Studio's AI Cleanup & Mastering — run on the cleaned
 * vocal and the backing track before any mastering decision is made, so those decisions come
 * from what this particular song and take actually need instead of one fixed recipe:
 *
 *  - key (chroma of the backing, Krumhansl-Kessler profiles) — pitch correction aims at the
 *    song's own scale instead of the nearest of all 12 semitones;
 *  - tempo (onset-envelope autocorrelation) — the reverb tail and pre-delay are timed to it;
 *  - band-by-band spectrum of the vocal and the backing — mud, presence, sibilance and air on the
 *    voice, and how much the music sits on top of the voice's intelligibility range (masking);
 *  - how busy the arrangement is and how unevenly the take was sung — vocal/playback gap and
 *    compression.
 *
 * Async and chunked: a full song is a few hundred thousand FFT bins' worth of work, so it yields
 * to the event loop between chunks (and reports progress) rather than freezing the page.
 */

const FFT_SIZE = 4096;
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// Krumhansl-Kessler key profiles, C-rooted.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
// Natural minor plus the raised 7th — minor melodies lean on the leading tone constantly.
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11];

/** Band edges in Hz. Values reported per band are mean power per FFT bin (spectral density), so
 * bands of different widths compare directly. */
const BANDS = {
  low: [40, 120],
  mud: [200, 500],
  body: [500, 2000],
  presence: [2000, 5000],
  sibilance: [5000, 9000],
  air: [9000, 16000],
} as const;
export type Bands = Record<keyof typeof BANDS, number>;

export type SongKey = {
  /** 0 = C … 11 = B */
  tonic: number;
  mode: "major" | "minor";
  /** Pitch classes (C = 0) pitch correction should aim at — this key's scale, widened by any
   * near-tied key (see detectKey). */
  scale: number[];
  /** The best key's profile correlation, 0-1: ~0.6+ on clearly tonal music, lower on ambiguous or
   * atonal material. */
  confidence: number;
};

export type SongAnalysis = {
  key: SongKey | null;
  tempoBpm: number | null;
  vocal: {
    bands: Bands;
    /** Gap between the take's loud and soft sung passages (p90 − p25 of active frames, dB). */
    phraseSpreadDb: number;
    /** Level of the take's loudest sibilance — 97th percentile of 5-10kHz band level over sung
     * frames, dBFS. The de-esser's threshold is set relative to this. */
    sibilancePeakDb: number;
  };
  backing: {
    bands: Bands;
    /** 0-1: how much of the song the arrangement is playing near full level — a ballad's sparse
     * piano lands low, a wall-to-wall pop production high. */
    density: number;
  } | null;
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function hann(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
function fft(re: Float64Array, im: Float64Array) {
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
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function mono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  const out = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) out[i] = (l[i] + r[i]) / 2;
  return out;
}

const toDb = (p: number) => (p > 0 ? 10 * Math.log10(p) : -120);
const percentile = (sorted: number[], p: number) =>
  sorted[Math.floor(p * (sorted.length - 1))] ?? -120;

type SpectralResult = {
  bands: Bands;
  chroma: Float64Array;
  frameDb: number[];
  activeDb: number[];
  sibilancePeakDb: number;
};

/** One windowed-FFT sweep over a signal: per-band density and chroma, both averaged over the
 * frames that actually carry the music/voice (silence and room tone would only dilute them). */
async function spectralPass(
  data: Float32Array,
  sampleRate: number,
  onProgress: (fraction: number) => void,
): Promise<SpectralResult> {
  const window = hann(FFT_SIZE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const binHz = sampleRate / FFT_SIZE;
  const half = FFT_SIZE / 2;
  const frames: { db: number; bandPower: number[]; chroma: Float64Array; sibDb: number }[] = [];
  const sibLo = Math.round(5000 / binHz);
  const sibHi = Math.min(half - 1, Math.round(10000 / binHz));
  // Parseval: a band's mean square in the signal is 2·Σ|X|² over its positive bins / (N · Σw²);
  // a Hann window's Σw² is 0.375·N.
  const bandMsScale = 2 / (FFT_SIZE * FFT_SIZE * 0.375);
  const bandKeys = Object.keys(BANDS) as (keyof typeof BANDS)[];
  const bandBins = bandKeys.map((k) => [
    Math.max(1, Math.round(BANDS[k][0] / binHz)),
    Math.min(half - 1, Math.round(BANDS[k][1] / binHz)),
  ]);
  // Bin → pitch class, only across the range where a 4096-point FFT still resolves semitones.
  const binPitchClass = new Int8Array(half).fill(-1);
  for (let b = 1; b < half; b++) {
    const f = b * binHz;
    if (f < 180 || f > 5000) continue;
    binPitchClass[b] = (((Math.round(12 * Math.log2(f / 440)) + 9) % 12) + 12) % 12;
  }

  const total = Math.max(1, Math.floor(data.length / FFT_SIZE));
  for (let f = 0, pos = 0; pos + FFT_SIZE <= data.length; f++, pos += FFT_SIZE) {
    let energy = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = data[pos + i];
      energy += s * s;
      re[i] = s * window[i];
      im[i] = 0;
    }
    fft(re, im);
    const power = new Float64Array(half);
    for (let b = 0; b < half; b++) power[b] = re[b] * re[b] + im[b] * im[b];
    const bandPower = bandBins.map(([lo, hi]) => {
      let sum = 0;
      for (let b = lo; b <= hi; b++) sum += power[b];
      return sum / Math.max(1, hi - lo + 1);
    });
    const chroma = new Float64Array(12);
    for (let b = 1; b < half; b++) {
      const pc = binPitchClass[b];
      if (pc >= 0) chroma[pc] += Math.sqrt(power[b]);
    }
    let sib = 0;
    for (let b = sibLo; b <= sibHi; b++) sib += power[b];
    frames.push({ db: toDb(energy / FFT_SIZE), bandPower, chroma, sibDb: toDb(sib * bandMsScale) });
    if (f % 48 === 47) {
      onProgress(f / total);
      await tick();
    }
  }

  const frameDb = frames.map((fr) => fr.db);
  const sorted = [...frameDb].sort((a, b) => a - b);
  const activeFloor = percentile(sorted, 0.9) - 30;
  const active = frames.filter((fr) => fr.db >= activeFloor);
  const bands = {} as Bands;
  bandKeys.forEach((k, i) => {
    const mean = active.reduce((s, fr) => s + fr.bandPower[i], 0) / Math.max(1, active.length);
    bands[k] = toDb(mean);
  });
  const chroma = new Float64Array(12);
  for (const fr of active) for (let pc = 0; pc < 12; pc++) chroma[pc] += fr.chroma[pc];
  onProgress(1);
  const sibSorted = active.map((fr) => fr.sibDb).sort((a, b) => a - b);
  return {
    bands,
    chroma,
    frameDb,
    activeDb: active.map((fr) => fr.db),
    sibilancePeakDb: percentile(sibSorted, 0.97),
  };
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function detectKey(chroma: Float64Array): SongKey | null {
  if (chroma.every((v) => v === 0)) return null;
  const fits: { tonic: number; mode: "major" | "minor"; r: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    // Rotate the chroma so `tonic` sits at index 0, then compare against the C-rooted profile.
    const rotated = Array.from({ length: 12 }, (_, i) => chroma[(i + tonic) % 12]);
    fits.push({ tonic, mode: "major", r: pearson(rotated, MAJOR_PROFILE) });
    fits.push({ tonic, mode: "minor", r: pearson(rotated, MINOR_PROFILE) });
  }
  fits.sort((x, y) => y.r - x.r);
  const best = fits[0];
  if (best.r < 0.4) return null;
  // Keys a fifth apart, or a parallel major/minor, share all but a note or two and routinely land
  // within a few hundredths of each other on real songs. Rather than bet on one of them, the scale
  // is the union of every near-tied key, so pitch correction never pulls a note away that belongs
  // to any key the song could plausibly be in.
  const scale = new Set<number>();
  for (const fit of fits.filter((f) => f.r >= best.r - 0.05)) {
    for (const iv of fit.mode === "major" ? MAJOR_SCALE : MINOR_SCALE) {
      scale.add((iv + fit.tonic) % 12);
    }
  }
  return {
    tonic: best.tonic,
    mode: best.mode,
    scale: [...scale].sort((a, b) => a - b),
    confidence: best.r,
  };
}

/** Onset-strength envelope (half-wave rectified rise in high-passed energy) autocorrelated over
 * 60-180 BPM, with a mild preference for the 90-130 range where most songs' felt beat sits so a
 * double/half-time reading doesn't win on a near tie. */
async function detectTempo(data: Float32Array, sampleRate: number): Promise<number | null> {
  const hop = 512;
  const envRate = sampleRate / hop;
  const env: number[] = [];
  let prev = 0;
  for (let pos = 1; pos + hop <= data.length; pos += hop) {
    let e = 0;
    for (let i = pos; i < pos + hop; i++) {
      const d = data[i] - data[i - 1];
      e += d * d;
    }
    const logE = Math.log10(1e-10 + e);
    env.push(Math.max(0, logE - prev));
    prev = logE;
  }
  if (env.length < envRate * 8) return null; // under ~8s there aren't enough beats to measure
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const centered = env.map((v) => v - mean);
  await tick();

  const minLag = Math.floor((60 / 180) * envRate);
  const maxLag = Math.ceil((60 / 60) * envRate);
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < centered.length; i++) s += centered[i] * centered[i - lag];
    const bpm = (60 * envRate) / lag;
    const preference = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.5) ** 2);
    scores.push((s / (centered.length - lag)) * (0.6 + 0.4 * preference));
  }
  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestIdx]) bestIdx = i;
  const avg = scores.reduce((a, b) => a + Math.max(0, b), 0) / scores.length;
  // A beat that barely stands out from the average lag is no beat (rubato, a cappella, ambient).
  if (scores[bestIdx] <= 0 || scores[bestIdx] < avg * 1.6) return null;
  const l = scores[bestIdx - 1] ?? scores[bestIdx];
  const r = scores[bestIdx + 1] ?? scores[bestIdx];
  const denom = l - 2 * scores[bestIdx] + r;
  const offset = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / denom)) : 0;
  return (60 * envRate) / (minLag + bestIdx + offset);
}

export async function analyzeSong(
  vocal: AudioBuffer,
  backing: AudioBuffer | null,
  onProgress: (fraction: number) => void = () => {},
): Promise<SongAnalysis> {
  // Progress budget: vocal spectrum 40%, backing spectrum 45%, tempo the rest.
  const vocalWeight = backing ? 0.4 : 0.9;
  const vocalSpec = await spectralPass(vocal.getChannelData(0), vocal.sampleRate, (f) =>
    onProgress(f * vocalWeight),
  );
  const sortedActive = [...vocalSpec.activeDb].sort((a, b) => a - b);
  const phraseSpreadDb = percentile(sortedActive, 0.9) - percentile(sortedActive, 0.25);

  if (!backing) {
    const key = detectKey(vocalSpec.chroma);
    onProgress(1);
    return {
      key,
      tempoBpm: null,
      vocal: {
        bands: vocalSpec.bands,
        phraseSpreadDb,
        sibilancePeakDb: vocalSpec.sibilancePeakDb,
      },
      backing: null,
    };
  }

  const backingMono = mono(backing);
  const backingSpec = await spectralPass(backingMono, backing.sampleRate, (f) =>
    onProgress(0.4 + f * 0.45),
  );
  const sortedBacking = [...backingSpec.frameDb].sort((a, b) => a - b);
  const loud = percentile(sortedBacking, 0.9);
  const density =
    backingSpec.frameDb.filter((db) => db >= loud - 10).length /
    Math.max(1, backingSpec.frameDb.length);
  const tempoBpm = await detectTempo(backingMono, backing.sampleRate);
  // The arrangement carries the harmony far more reliably than a single melodic line does.
  const key = detectKey(backingSpec.chroma) ?? detectKey(vocalSpec.chroma);
  onProgress(1);
  return {
    key,
    tempoBpm,
    vocal: {
      bands: vocalSpec.bands,
      phraseSpreadDb,
      sibilancePeakDb: vocalSpec.sibilancePeakDb,
    },
    backing: { bands: backingSpec.bands, density },
  };
}

/**
 * Integrated loudness per ITU-R BS.1770-4 (what LUFS meters and streaming services' normalization
 * measure): K-weighting (a +4dB shelf above ~1.7kHz and a 38Hz high-pass, the two biquads below,
 * derived for any sample rate the way pyloudnorm does), 400ms blocks every 100ms, an absolute gate
 * at −70 LUFS and a relative gate 10 LU under the ungated mean. Also returns the sample peak.
 */
export function measureLoudness(
  channels: Float32Array[],
  sampleRate: number,
): { lufs: number; peakDb: number } {
  const shelf = (() => {
    const f0 = 1681.974450955533;
    const gain = 3.999843853973347;
    const q = 0.7071752369554196;
    const k = Math.tan((Math.PI * f0) / sampleRate);
    const vh = 10 ** (gain / 20);
    const vb = vh ** 0.4996667741545416;
    const a0 = 1 + k / q + k * k;
    return [
      (vh + (vb * k) / q + k * k) / a0,
      (2 * (k * k - vh)) / a0,
      (vh - (vb * k) / q + k * k) / a0,
      (2 * (k * k - 1)) / a0,
      (1 - k / q + k * k) / a0,
    ];
  })();
  const highpass = (() => {
    const f0 = 38.13547087602444;
    const q = 0.5003270373238773;
    const k = Math.tan((Math.PI * f0) / sampleRate);
    const a0 = 1 + k / q + k * k;
    return [1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0];
  })();
  const biquad = (x: Float32Array, [b0, b1, b2, a1, a2]: number[]) => {
    const y = new Float32Array(x.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    return y;
  };

  let peak = 0;
  for (const ch of channels)
    for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const weighted = channels.map((ch) => biquad(biquad(ch, shelf), highpass));
  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  const length = channels[0]?.length ?? 0;
  const blocks: number[] = [];
  for (let start = 0; start + block <= length; start += step) {
    let power = 0;
    for (const ch of weighted) {
      let sum = 0;
      for (let i = start; i < start + block; i++) sum += ch[i] * ch[i];
      power += sum / block;
    }
    blocks.push(power);
  }
  const loudnessOf = (power: number) => -0.691 + 10 * Math.log10(Math.max(power, 1e-12));
  const meanPower = (list: number[]) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  const absGated = blocks.filter((p) => loudnessOf(p) > -70);
  const relativeGate = loudnessOf(meanPower(absGated)) - 10;
  const gated = absGated.filter((p) => loudnessOf(p) > relativeGate);
  return {
    lufs: gated.length > 0 ? loudnessOf(meanPower(gated)) : -70,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -100,
  };
}
