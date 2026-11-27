/**
 * Vocal prep — the editing an engineer does on a lead vocal before it ever reaches a compressor
 * (clip-gain leveling and breath control), done from measurements of the take:
 *
 *  - Phrase riding (what Waves Vocal Rider or hand-drawn clip gain does): each phrase's level is
 *    measured over ±250ms and pulled halfway toward the take's typical phrase level, at most −4 dB
 *    / +5 dB. Compression alone can't do this — it reacts to peaks within a few hundred ms and
 *    can't tell a soft verse line from a loud chorus line — so a quiet line otherwise drops behind
 *    the music while a loud one gets squashed. Gaps between phrases are left at unity, so the room
 *    and the gaps' noise are never lifted.
 *  - Breath softening: a breath before a line is noise-like (many zero crossings, no pitch), well
 *    under the singing, and lasts a fifth of a second or more. Compression lifts exactly that, and
 *    a lifted inhale before every line is one of the clearest tells of an unedited vocal. They're
 *    turned down by BREATH_CUT_DB, not removed — engineers keep them, since a vocal with no
 *    breaths at all sounds unnatural. Consonants (s, sh, ח) are shorter or louder than a breath,
 *    so they don't qualify.
 *
 * Destructive like the noise gate: Studio applies it to the loaded buffer after gating and pitch
 * correction, every time it rebuilds the take from the untouched original.
 */

const HOP_SEC = 0.01;
const WINDOW_SEC = 0.03;
/** How far each phrase is pulled toward the typical phrase level — half keeps the singer's own
 * dynamics (a chorus still lifts), it just closes the gap. */
const RIDE_AMOUNT = 0.5;
const RIDE_MAX_CUT_DB = 4;
const RIDE_MAX_BOOST_DB = 5;
const PHRASE_RADIUS_SEC = 0.25;
/** A gap between phrases longer than this goes back to unity gain. */
const HOLD_SEC = 0.3;
const SMOOTH_RADIUS_SEC = 0.1;
const BREATH_CUT_DB = 6;
const BREATH_MIN_SEC = 0.18;
const BREATH_MAX_SEC = 1.2;
/** Zero crossings per sample: a sung vowel sits around 0.01-0.05, breath noise (energy mostly
 * 1-5kHz) well above it. */
const BREATH_MIN_ZCR = 0.06;

type Frames = { level: Float64Array; zcr: Float64Array; hop: number };

function frameStats(data: Float32Array, sampleRate: number): Frames {
  const hop = Math.max(1, Math.round(HOP_SEC * sampleRate));
  const win = Math.max(hop, Math.round(WINDOW_SEC * sampleRate));
  const count = Math.max(0, Math.floor((data.length - win) / hop) + 1);
  const level = new Float64Array(count);
  const zcr = new Float64Array(count);
  for (let f = 0; f < count; f++) {
    const start = f * hop;
    let sum = 0;
    let crossings = 0;
    for (let i = start; i < start + win; i++) {
      sum += data[i] * data[i];
      if (i > start && data[i] >= 0 !== data[i - 1] >= 0) crossings++;
    }
    level[f] = 10 * Math.log10(sum / win + 1e-12);
    zcr[f] = crossings / win;
  }
  return { level, zcr, hop };
}

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return -120;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
};

function boxSmooth(values: Float64Array, radius: number): Float64Array {
  const n = values.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n, i + radius + 1);
    out[i] = (prefix[hi] - prefix[lo]) / (hi - lo);
  }
  return out;
}

/** Frames that are singing (not room, not silence): well over the take's floor and within 35 dB
 * of its loud passages. */
function activeMask(level: Float64Array): { active: Uint8Array; floor: number; loud: number } {
  const all = Array.from(level);
  const floor = percentile(all, 0.1);
  const loud = percentile(all, 0.9);
  const threshold = Math.max(floor + 10, loud - 35);
  const active = new Uint8Array(level.length);
  for (let i = 0; i < level.length; i++) active[i] = level[i] > threshold ? 1 : 0;
  return { active, floor, loud };
}

export type VocalPrepResult = {
  /** Breaths turned down. */
  breaths: number;
  /** The widest ride applied anywhere, dB (boost or cut). */
  rideDb: number;
};

/** Per-frame gain (dB) for a take — see the file comment. */
function prepGains(data: Float32Array, sampleRate: number) {
  const { level, zcr, hop } = frameStats(data, sampleRate);
  const n = level.length;
  const frameSec = hop / sampleRate;
  const { active, floor } = activeMask(level);

  // Phrase level: power average over the active frames within ±250ms.
  const radius = Math.round(PHRASE_RADIUS_SEC / frameSec);
  const power = new Float64Array(n);
  const ones = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!active[i]) continue;
    power[i] = 10 ** (level[i] / 10);
    ones[i] = 1;
  }
  const powerSum = boxSmooth(power, radius);
  const countSum = boxSmooth(ones, radius);
  const phrase = new Float64Array(n).fill(NaN);
  const phraseLevels: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!active[i] || countSum[i] * (2 * radius + 1) < 5) continue;
    phrase[i] = 10 * Math.log10(powerSum[i] / countSum[i]);
    phraseLevels.push(phrase[i]);
  }
  const target = percentile(phraseLevels, 0.5);

  const ride = new Float64Array(n).fill(NaN);
  let rideDb = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(phrase[i])) continue;
    ride[i] = Math.max(
      -RIDE_MAX_CUT_DB,
      Math.min(RIDE_MAX_BOOST_DB, (target - phrase[i]) * RIDE_AMOUNT),
    );
  }
  // Gaps: hold the nearest phrase's gain for up to HOLD_SEC, then unity.
  const hold = Math.round(HOLD_SEC / frameSec);
  const filled = new Float64Array(n);
  let last = -Infinity;
  const nextKnown = new Int32Array(n).fill(-1);
  for (let i = n - 1, next = -1; i >= 0; i--) {
    if (!Number.isNaN(ride[i])) next = i;
    nextKnown[i] = next;
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(ride[i])) {
      filled[i] = ride[i];
      last = i;
      continue;
    }
    const next = nextKnown[i];
    const fromLast = i - last;
    const toNext = next >= 0 ? next - i : Infinity;
    if (fromLast <= hold && fromLast <= toNext) filled[i] = ride[last];
    else if (toNext <= hold) filled[i] = ride[next];
    else filled[i] = 0;
  }
  const smoothRide = boxSmooth(filled, Math.round(SMOOTH_RADIUS_SEC / frameSec));

  // Breaths: noise-like, clearly under the singing, a fifth of a second or longer.
  const breathFrame = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    breathFrame[i] =
      level[i] > floor + 4 && level[i] < target - 14 && zcr[i] >= BREATH_MIN_ZCR ? 1 : 0;
  }
  const breath = new Float64Array(n);
  let breaths = 0;
  const minFrames = Math.round(BREATH_MIN_SEC / frameSec);
  const maxFrames = Math.round(BREATH_MAX_SEC / frameSec);
  for (let a = 0; a < n;) {
    if (!breathFrame[a]) {
      a++;
      continue;
    }
    let b = a;
    while (b < n && breathFrame[b]) b++;
    if (b - a >= minFrames && b - a <= maxFrames) {
      breath.fill(-BREATH_CUT_DB, a, b);
      breaths++;
    }
    a = b;
  }
  const smoothBreath = boxSmooth(breath, 2);

  const gains = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gains[i] = smoothRide[i] + smoothBreath[i];
    rideDb = Math.max(rideDb, Math.abs(smoothRide[i]));
  }
  return { gains, hop, win: Math.round(WINDOW_SEC * sampleRate), breaths, rideDb };
}

/** Rides and de-breathes `channels` in place (measured on channel 0, applied to all). */
export function applyVocalPrep(channels: Float32Array[], sampleRate: number): VocalPrepResult {
  if (channels.length === 0 || channels[0].length === 0) return { breaths: 0, rideDb: 0 };
  const { gains, hop, win, breaths, rideDb } = prepGains(channels[0], sampleRate);
  const n = channels[0].length;
  // Frame f's gain sits at its window's center; linear between centers.
  const offset = win / 2;
  for (const data of channels) {
    for (let i = 0; i < n; i++) {
      const x = (i - offset) / hop;
      const f = Math.floor(x);
      const t = x - f;
      const g0 = gains[Math.min(gains.length - 1, Math.max(0, f))] ?? 0;
      const g1 = gains[Math.min(gains.length - 1, Math.max(0, f + 1))] ?? 0;
      data[i] *= 10 ** ((g0 + (g1 - g0) * t) / 20);
    }
  }
  return { breaths, rideDb: Math.round(rideDb * 10) / 10 };
}

/** A sung line's end: it ran at least this long, then the singer stopped for at least
 * THROW_GAP_SEC. Shorter pauses are breaths inside a line. */
const THROW_LINE_MIN_SEC = 0.8;
const THROW_GAP_SEC = 0.5;
/** How much of the end of the line is sent — about its last word. */
const THROW_TAIL_SEC = 0.35;

/**
 * Where a "delay throw" should catch the voice: 1 over the last word of each sung line (the end
 * of a phrase followed by a real pause), 0 everywhere else, with 30ms ramps — engineers echo the
 * ends of lines into the gap that follows rather than putting echo on every word, which smears
 * running lyrics. Sampled at `envelopeRate` Hz.
 */
export function phraseEndEnvelope(
  data: Float32Array,
  sampleRate: number,
  envelopeRate: number,
): { envelope: Float32Array; throws: number } {
  const { level, hop } = frameStats(data, sampleRate);
  const n = level.length;
  const frameSec = hop / sampleRate;
  const { active } = activeMask(level);
  // Bridge tiny dips (between syllables) so a line reads as one run.
  const bridge = Math.round(0.15 / frameSec);
  const line = Uint8Array.from(active);
  for (let i = 0, lastActive = -Infinity; i < n; i++) {
    if (active[i]) {
      if (i - lastActive > 1 && i - lastActive <= bridge) line.fill(1, lastActive + 1, i);
      lastActive = i;
    }
  }
  const frames = new Float64Array(n);
  let throws = 0;
  const minLine = Math.round(THROW_LINE_MIN_SEC / frameSec);
  const gap = Math.round(THROW_GAP_SEC / frameSec);
  const tail = Math.round(THROW_TAIL_SEC / frameSec);
  for (let a = 0; a < n;) {
    if (!line[a]) {
      a++;
      continue;
    }
    let b = a;
    while (b < n && line[b]) b++;
    let quiet = 0;
    while (b + quiet < n && !line[b + quiet] && quiet < gap) quiet++;
    if (b - a >= minLine && quiet >= gap) {
      frames.fill(1, Math.max(a, b - tail), b);
      throws++;
    }
    a = b;
  }
  const smooth = boxSmooth(frames, 3);
  const length = Math.max(1, Math.ceil((data.length / sampleRate) * envelopeRate));
  const envelope = new Float32Array(length);
  const offset = Math.round(WINDOW_SEC * sampleRate) / 2;
  for (let k = 0; k < length; k++) {
    const f = Math.round(((k / envelopeRate) * sampleRate - offset) / hop);
    envelope[k] = smooth[Math.min(n - 1, Math.max(0, f))] ?? 0;
  }
  return { envelope, throws };
}
