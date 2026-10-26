// Real pitch detection + correction — the engine behind studio.tsx's "Autotune" slider and AI
// mastering's automatic tuning. A live Tone.PitchShift can only apply one fixed shift to the whole
// signal, so this works offline on the loaded buffer instead: track the sung pitch (YIN), split it
// into notes the way a pitch editor does, move each note's center toward its target and pull in
// slow drift while leaving vibrato and note attacks as sung (see shiftTrack), then resynthesize with
// TD-PSOLA, which shifts pitch without moving the voice's formants (see psola). Only what was
// actually moved is resynthesized; everything else is the original signal, untouched. Studio bakes
// it in a beat after the slider stops moving, or immediately when AI mastering decides a take
// needs it.

const MIN_HZ = 75; // under a low male singer's E2 (82Hz)
const MAX_HZ = 1000; // over a high soprano/falsetto's B5 (988Hz)
// YIN (de Cheveigné & Kawahara, 2002): the first lag whose normalized difference dips under this is
// the period — taking the first dip rather than the deepest is what keeps it from locking onto
// two or three periods (an octave or more too low).
const YIN_THRESHOLD = 0.15;
// No dip this deep anywhere: breath, a consonant or noise, not a note — left unvoiced rather than
// guessed at, since a wrong pitch there is what feeds a correction a bogus target.
const YIN_UNVOICED = 0.3;
// The coarse lag search runs on a 4x-decimated copy (sung pitch lives well under its Nyquist once
// low-passed), then only the lags around the winner are refined at full rate.
const DECIM = 4;

function hannWindow(size: number): Float32Array {
  // Periodic (denominator = size, not size-1) form: overlap-adding this at hop = size/2 sums to an
  // exact constant, so the reconstruction below never needs a separate normalization pass.
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}

/** Two cascaded one-pole low-passes. Detection runs on this copy: with the formants and sibilance
 * rolled off, a period's waveform repeats cleanly and its pitch-mark peaks don't jump between
 * formant ripples from one cycle to the next. */
function lowpass(data: Float32Array, sampleRate: number, hz: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
  const out = Float32Array.from(data);
  for (let pass = 0; pass < 2; pass++) {
    let y = 0;
    for (let i = 0; i < out.length; i++) {
      y += (out[i] - y) * a;
      out[i] = y;
    }
  }
  return out;
}

/**
 * Where a sung frequency should be pulled to. Without a scale, the nearest chromatic note. With
 * the song's scale (pitch classes, C = 0 — see song-analysis.ts), a frame whose nearest semitone
 * falls outside the key is pulled to the closer in-key neighbor instead, since that's almost always
 * a missed note — unless it's already sung within 30 cents of that out-of-key semitone, which is a
 * deliberate chromatic/blue note sung in tune and is left where the singer put it.
 */
export function targetNoteFreq(freq: number, scale?: readonly number[], referenceA4 = 440): number {
  const semitones = 12 * Math.log2(freq / referenceA4);
  const nearest = Math.round(semitones);
  const pitchClass = (n: number) => (((n + 9) % 12) + 12) % 12; // semitones from A4 → C = 0
  if (!scale || scale.includes(pitchClass(nearest)) || Math.abs(semitones - nearest) < 0.3) {
    return referenceA4 * 2 ** (nearest / 12);
  }
  const candidates = [nearest - 1, nearest + 1].filter((n) => scale.includes(pitchClass(n)));
  if (candidates.length === 0) return referenceA4 * 2 ** (nearest / 12);
  const best = candidates.reduce((a, b) =>
    Math.abs(semitones - a) <= Math.abs(semitones - b) ? a : b,
  );
  return referenceA4 * 2 ** (best / 12);
}

function frameSizeFor(sampleRate: number): number {
  return Math.max(512, Math.floor(sampleRate * 0.023)); // ~23ms — a couple of periods even at 80Hz
}

/**
 * Silence floor for detection, relative to the take's own loud passages (20 dB under its
 * 90th-percentile frame RMS) instead of one absolute level — a model-cleaned or quietly recorded
 * take spends much of its singing under −40 dBFS and would otherwise read as unvoiced.
 */
function silenceFloorFor(data: Float32Array, frameSize: number, hop: number): number {
  const levels: number[] = [];
  for (let pos = 0; pos + frameSize <= data.length; pos += hop * 4) {
    let sum = 0;
    for (let i = pos; i < pos + frameSize; i++) sum += data[i] * data[i];
    levels.push(Math.sqrt(sum / frameSize));
  }
  levels.sort((a, b) => a - b);
  const loud = levels[Math.floor(0.9 * (levels.length - 1))] ?? 0;
  return Math.max(1e-4, loud * 0.1);
}

/**
 * YIN pitch track over the whole take. Per frame: the squared-difference function of the frame
 * against itself at every candidate lag, normalized by its own running mean (the "cumulative mean
 * normalized difference"), and the first lag that dips under YIN_THRESHOLD is the period — refined
 * at full resolution and to a fraction of a sample by parabolic interpolation. Accurate to well
 * under a cent on a steady note, which correction needs: it decides how far off each note is.
 */
function detectPitchTrack(
  raw: Float32Array,
  filtered: Float32Array,
  sampleRate: number,
  frameSize: number,
  hop: number,
): (number | null)[] {
  const silenceRms = silenceFloorFor(raw, frameSize, hop);
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.ceil(sampleRate / MIN_HZ);
  const fullWindow = frameSize - maxLag;
  const decMinLag = Math.max(2, Math.floor(minLag / DECIM));
  const decMaxLag = Math.ceil(maxLag / DECIM);
  const decWindow = Math.floor(frameSize / DECIM) - decMaxLag;

  const decimated = new Float32Array(Math.floor(filtered.length / DECIM));
  for (let k = 0; k < decimated.length; k++) {
    let sum = 0;
    for (let j = 0; j < DECIM; j++) sum += filtered[k * DECIM + j];
    decimated[k] = sum / DECIM;
  }

  const diff = new Float64Array(decMaxLag + 1);
  const fullDiffAt = (pos: number, lag: number) => {
    let d = 0;
    for (let j = 0; j < fullWindow; j++) {
      const delta = filtered[pos + j] - filtered[pos + j + lag];
      d += delta * delta;
    }
    return d;
  };

  const track: (number | null)[] = [];
  for (let pos = 0; pos + frameSize <= raw.length; pos += hop) {
    let energy = 0;
    for (let i = pos; i < pos + frameSize; i++) energy += raw[i] * raw[i];
    if (Math.sqrt(energy / frameSize) < silenceRms) {
      track.push(null); // breath/room noise, not a note
      continue;
    }

    const d0 = Math.floor(pos / DECIM);
    let running = 0;
    let picked = -1;
    let bestTau = -1;
    let bestCmnd = Infinity;
    const cmnd = (tau: number) => (running > 0 ? (diff[tau] * tau) / running : 1);
    for (let tau = 1; tau <= decMaxLag; tau++) {
      let d = 0;
      for (let j = 0; j < decWindow; j++) {
        const delta = decimated[d0 + j] - decimated[d0 + j + tau];
        d += delta * delta;
      }
      diff[tau] = d;
      running += d;
      if (tau < decMinLag) continue;
      const v = cmnd(tau);
      if (v < bestCmnd) {
        bestCmnd = v;
        bestTau = tau;
      }
      if (picked < 0 && v < YIN_THRESHOLD) picked = tau;
      // Inside the first dip: keep walking down it to its bottom, then stop.
      if (picked >= 0 && tau > picked) {
        const prevRunning = running - d;
        const prev = prevRunning > 0 ? (diff[tau - 1] * (tau - 1)) / prevRunning : 1;
        if (v >= prev) {
          picked = tau - 1;
          break;
        }
        picked = tau;
      }
    }
    if (picked < 0) {
      if (bestCmnd > YIN_UNVOICED) {
        track.push(null);
        continue;
      }
      picked = bestTau;
    }

    // Full-resolution refinement around the coarse winner, then sub-sample parabolic vertex.
    const lo = Math.max(minLag, picked * DECIM - DECIM - 2);
    const hi = Math.min(maxLag, picked * DECIM + DECIM + 2);
    let bestLag = lo;
    let bestD = Infinity;
    for (let lag = lo; lag <= hi; lag++) {
      const d = fullDiffAt(pos, lag);
      if (d < bestD) {
        bestD = d;
        bestLag = lag;
      }
    }
    let refined = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const left = fullDiffAt(pos, bestLag - 1);
      const right = fullDiffAt(pos, bestLag + 1);
      const denom = left - 2 * bestD + right;
      if (denom > 0) refined += Math.max(-1, Math.min(1, (0.5 * (left - right)) / denom));
    }
    track.push(sampleRate / refined);
  }
  return track;
}

/**
 * Median-of-up-to-5 filter over a raw pitch track. Rejects a single frame locking onto half or
 * double the true period (an octave error) as the outlier it is, rather than as real pitch
 * content that the correction below would otherwise try to snap toward a wildly wrong note. A
 * position only gets a filtered value when at least 3 of its (up to 5) neighbors are voiced;
 * thin/isolated voiced blips stay null rather than getting invented pitch content.
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

type PitchTrack = {
  frameSize: number;
  hop: number;
  /** Median-filtered f0 per frame (Hz), null where unvoiced. Frame i is centered on
   * i * hop + frameSize / 2. */
  f0: (number | null)[];
  /** The low-passed signal detection ran on — pitch marks are placed on it too. */
  filtered: Float32Array;
};

/** 40ms frames (YIN needs a couple of periods of the lowest note plus the lag range on top) on a
 * 10ms hop: fine enough to follow vibrato (~17 points per 6Hz cycle) and note onsets, which the
 * per-note correction below has to tell apart. */
function trackPitch(data: Float32Array, sampleRate: number): PitchTrack {
  const frameSize = Math.floor(sampleRate * 0.04);
  const hop = Math.floor(frameSize / 4);
  const filtered = lowpass(data, sampleRate, 1200);
  return {
    frameSize,
    hop,
    f0: medianFilterPitch(detectPitchTrack(data, filtered, sampleRate, frameSize, hop)),
    filtered,
  };
}

const toSemis = (hz: number, referenceA4: number) => 12 * Math.log2(hz / referenceA4);

type Note = {
  /** Frame range [start, end). */
  start: number;
  end: number;
  /** Sung pitch per frame, semitones from A4. */
  semis: number[];
  /** Median sung pitch over the note, semitones from A4. */
  centerSemis: number;
  /** Where the note should be (see targetNoteFreq), semitones from A4. */
  targetSemis: number;
};

/**
 * Splits the pitch track into notes the way a pitch editor's "blobs" do: a run of voiced frames
 * that stays near its own center. Vibrato (a fast swing of up to about a semitone around the
 * note) stays inside one note; a jump to a new pitch, or drifting more than ~0.9 semitone from
 * where the run has been, starts the next one. Runs under 50ms (scoops, consonant blips) aren't
 * notes and are never corrected.
 */
function segmentNotes(
  track: PitchTrack,
  sampleRate: number,
  scale: readonly number[] | undefined,
  referenceA4: number,
): Note[] {
  const minFrames = Math.ceil((0.05 * sampleRate) / track.hop);
  const notes: Note[] = [];
  let run: number[] = [];
  let runStart = 0;
  let runSum = 0;
  const flush = (end: number) => {
    if (run.length >= minFrames) {
      const sorted = [...run].sort((a, b) => a - b);
      const centerSemis = sorted[Math.floor(sorted.length / 2)];
      const targetSemis = toSemis(
        targetNoteFreq(referenceA4 * 2 ** (centerSemis / 12), scale, referenceA4),
        referenceA4,
      );
      notes.push({ start: runStart, end, semis: run, centerSemis, targetSemis });
    }
    run = [];
    runSum = 0;
  };
  track.f0.forEach((f0, i) => {
    if (f0 == null) {
      flush(i);
      return;
    }
    const s = toSemis(f0, referenceA4);
    if (
      run.length > 0 &&
      (Math.abs(s - run[run.length - 1]) > 0.5 || Math.abs(s - runSum / run.length) > 0.9)
    ) {
      flush(i);
    }
    if (run.length === 0) runStart = i;
    run.push(s);
    runSum += s;
  });
  flush(track.f0.length);
  return notes;
}

export type PitchProfile = {
  /** Fraction of analyzed frames that carried a confident, median-filtered pitch — low for
   * spoken-word or mostly-consonant takes, where there's little sustained pitch worth correcting. */
  voicedRatio: number;
  /** How far sung notes sit from where they should be (see targetNoteFreq), in cents — measured on
   * each note's center, length-weighted, so vibrato around a correctly-centered note doesn't
   * count as being off. */
  avgAbsCents: number;
  /** Notes found, and how many sat more than 20 cents off — the threshold where a note starts to
   * read as out of tune to most listeners. */
  noteCount: number;
  offNotes: number;
  /** The low end of the sung range (10th percentile of voiced pitch), Hz — null with too little
   * sustained singing to tell. Anything filtered out below this would be the voice itself. */
  lowHz: number | null;
};

/** Detection only — what applyPitchCorrection would work with, without changing anything. */
export function analyzePitch(
  buffer: AudioBuffer,
  scale?: readonly number[],
  referenceA4 = 440,
): PitchProfile {
  const track = trackPitch(buffer.getChannelData(0), buffer.sampleRate);
  const notes = segmentNotes(track, buffer.sampleRate, scale, referenceA4);
  const voicedHz = track.f0.filter((f): f is number => f != null).sort((a, b) => a - b);
  let weighted = 0;
  let frames = 0;
  let offNotes = 0;
  for (const note of notes) {
    const cents = Math.abs(note.targetSemis - note.centerSemis) * 100;
    weighted += cents * (note.end - note.start);
    frames += note.end - note.start;
    if (cents > 20) offNotes++;
  }
  return {
    voicedRatio: track.f0.length > 0 ? voicedHz.length / track.f0.length : 0,
    avgAbsCents: frames > 0 ? weighted / frames : 0,
    noteCount: notes.length,
    offNotes,
    lowHz: voicedHz.length >= 40 ? voicedHz[Math.floor(voicedHz.length * 0.1)] : null,
  };
}

function sampleAt(data: Float32Array, x: number): number {
  if (x < 0 || x >= data.length) return 0;
  const i0 = Math.floor(x);
  if (i0 >= data.length - 1) return data[i0];
  const frac = x - i0;
  return data[i0] * (1 - frac) + data[i0 + 1] * frac;
}

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * Per-frame pitch shift (semitones) for a take, the way an engineer tunes a lead vocal by hand in
 * a pitch editor — transparent, not "snap every frame to the grid," which is what flattens a voice
 * into the robotic effect:
 *  - each note's center is moved toward its target (Melodyne's "pitch center"). The full `strength`
 *    goes on the top of the singer's range, where pitch slips most (strained, usually flat high
 *    notes) and where it's most exposed; the middle and bottom of the range get 65% of it;
 *  - a note already within ~6 cents is left exactly where it was sung (nobody hears that; moving it
 *    only costs naturalness), with correction phased in fully by ~15 cents off;
 *  - short notes (under ~150ms — passing tones, runs, melisma) are eased off: correcting them hard
 *    is what makes fast singing sound stepped;
 *  - slow wandering within a note (drift, smoothed over ±150ms, wider than one 5-6Hz vibrato
 *    cycle) is pulled back toward the note's center by 60% of the note's strength ("pitch drift"),
 *    only the part beyond ±10 cents — any held note wanders that much, and whatever vibrato leaks
 *    through the smoothing stays under it — and not over its first 80ms, the scoop/attack into the
 *    note, which is the singer's own phrasing;
 *  - anything faster than that — vibrato, the singer's own expression — is left exactly as sung;
 *  - the shift moves between notes with a retune-speed time constant (~35ms at the 0.8-0.9 AI
 *    mastering uses, slower below), so note changes glide instead of snapping.
 * A note whose shift never reaches MIN_CORRECTION isn't touched at all. `active` marks the frames
 * that are being moved: corrected notes, plus the glide back to zero after each one.
 */
function shiftTrack(track: PitchTrack, notes: Note[], strength: number, sampleRate: number) {
  const n = track.f0.length;
  const raw = new Float32Array(n);
  const active = new Uint8Array(n);
  const frameSec = track.hop / sampleRate;
  const driftRadius = Math.max(1, Math.round(0.15 / frameSec));
  const attackFrames = 0.08 / frameSec;

  // The singer's range, from every sung frame: the median and the 90th percentile.
  const all = notes.flatMap((note) => note.semis).sort((a, b) => a - b);
  const mid = all[Math.floor(all.length * 0.5)] ?? 0;
  const top = Math.max(mid + 1, all[Math.floor(all.length * 0.9)] ?? 0);

  for (const note of notes) {
    const { semis } = note;
    const error = note.targetSemis - note.centerSemis;
    const noteStrength =
      strength *
      (0.65 + 0.35 * smoothstep(mid, top, note.centerSemis)) *
      smoothstep(0.06, 0.15, semis.length * frameSec);
    const centerShift = error * noteStrength * smoothstep(0.06, 0.15, Math.abs(error));
    let largest = 0;
    for (let i = 0; i < semis.length; i++) {
      let sum = 0;
      let count = 0;
      for (
        let j = Math.max(0, i - driftRadius);
        j <= Math.min(semis.length - 1, i + driftRadius);
        j++
      ) {
        sum += semis[j];
        count++;
      }
      const wander = sum / count - note.centerSemis;
      const drift = Math.sign(wander) * Math.max(0, Math.abs(wander) - 0.1);
      const attack = smoothstep(0, attackFrames, i);
      const shift = centerShift - drift * noteStrength * 0.6 * attack;
      raw[note.start + i] = shift;
      largest = Math.max(largest, Math.abs(shift));
    }
    if (largest < MIN_CORRECTION) raw.fill(0, note.start, note.end);
    else active.fill(1, note.start, note.end);
  }
  const retuneMs = 80 - 50 * strength;
  const alpha = 1 - Math.exp(-(frameSec * 1000) / retuneMs);
  const shifts = new Float32Array(n);
  let state = 0;
  for (let i = 0; i < n; i++) {
    state += (raw[i] - state) * alpha;
    shifts[i] = state;
    if (!active[i] && i > 0 && active[i - 1] && Math.abs(state) > 0.002) active[i] = 1;
  }
  return { shifts, active };
}

/** Semitones (2 cents): a note that would move less than this anywhere is left as sung — nobody
 * hears it, and resynthesizing it would only cost naturalness. */
const MIN_CORRECTION = 0.02;

/**
 * TD-PSOLA (pitch-synchronous overlap-add) resynthesis. The voice is cut into two-period grains
 * centered on its own pitch pulses, and the grains are laid back down closer together (higher
 * pitch) or further apart (lower) — each grain itself is never resampled, so the vocal tract's
 * formants stay where they are and a shifted note still sounds like the same singer, without the
 * phasey warble of plain grain resampling. Outside the stretches being moved (`activeAt`), and
 * through unvoiced ones, each grain goes back exactly where it came from, which reconstructs the
 * original — and puts the output back in phase with it at the start of every corrected note, so
 * applyPitchCorrection can crossfade between the two.
 */
function psola(
  input: Float32Array,
  marks: Int32Array,
  periods: Float32Array,
  voiced: Uint8Array,
  shiftAt: (sample: number) => number,
  activeAt: (sample: number) => boolean,
): Float32Array {
  const n = input.length;
  const out = new Float32Array(n);
  const weight = new Float32Array(n);
  let k = 0;
  let ts = marks.length > 0 ? marks[0] : 0;
  while (ts < n && marks.length > 0) {
    while (k + 1 < marks.length && Math.abs(marks[k + 1] - ts) <= Math.abs(marks[k] - ts)) k++;
    const m = marks[k];
    const period = periods[k];
    const half = Math.max(2, Math.round(period));
    const resync = !voiced[k] || !activeAt(Math.round(ts));
    const shift = resync ? 0 : shiftAt(Math.round(ts));
    const dst = resync ? m : Math.round(ts);
    for (let j = -half; j <= half; j++) {
      const src = m + j;
      const d = dst + j;
      if (src < 0 || src >= n || d < 0 || d >= n) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * j) / half);
      out[d] += input[src] * w;
      weight[d] += w;
    }
    const next = (resync ? m : ts) + (resync ? period : period / 2 ** (shift / 12));
    // Always move forward, even through a run of marks bunched closer than a period.
    ts = Math.max(next, ts + 1);
  }
  for (let i = 0; i < n; i++) out[i] = weight[i] > 1e-3 ? out[i] / Math.max(weight[i], 0.25) : 0;
  return out;
}

/** Pitch marks: one per glottal pulse through voiced stretches (each locked to the low-passed
 * waveform's peak nearest one period on from the last, so grains line up in phase), and a fixed
 * ~6ms step through unvoiced ones. */
function pitchMarks(data: Float32Array, sampleRate: number, track: PitchTrack) {
  const marks: number[] = [];
  const periods: number[] = [];
  const voiced: number[] = [];
  const unvoicedStep = Math.round(sampleRate * 0.006);
  const periodAt = (t: number) => {
    const frame = Math.round((t - track.frameSize / 2) / track.hop);
    const f0 = track.f0[Math.min(track.f0.length - 1, Math.max(0, frame))];
    return f0 ? sampleRate / f0 : null;
  };
  let t = 0;
  let lastVoiced = false;
  while (t < data.length) {
    const period = periodAt(t);
    if (period == null) {
      marks.push(t);
      periods.push(unvoicedStep);
      voiced.push(0);
      t += unvoicedStep;
      lastVoiced = false;
      continue;
    }
    // First pulse of a voiced stretch: the peak within one period; after that, the peak within a
    // quarter of a period either side of where the next pulse should be.
    const lo = lastVoiced ? Math.round(t - period / 4) : t;
    const hi = Math.min(data.length - 1, Math.round(lastVoiced ? t + period / 4 : t + period));
    let peak = Math.max(0, lo);
    for (let i = peak; i <= hi; i++) if (data[i] > data[peak]) peak = i;
    if (marks.length > 0 && peak <= marks[marks.length - 1]) peak = marks[marks.length - 1] + 1;
    marks.push(peak);
    periods.push(period);
    voiced.push(1);
    lastVoiced = true;
    t = peak + Math.round(period);
  }
  return {
    marks: Int32Array.from(marks),
    periods: Float32Array.from(periods),
    voiced: Uint8Array.from(voiced),
  };
}

/**
 * Destructively retunes the buffer: track the sung pitch, split it into notes, decide a per-frame
 * shift (see shiftTrack), and resynthesize with PSOLA. `strength` is 0-1 — AI mastering uses
 * 0.8-0.9, the "natural but in tune" range pitch-editing guides recommend; 1 is full correction.
 * Notes are aimed at the song's scale when one is given (see targetNoteFreq), on the backing
 * track's own tuning (`referenceA4`, see song-analysis.ts's tuningCents). Only the stretches
 * actually being moved come from the resynthesis, crossfaded in and out over ~10ms; the rest of
 * the take stays the original samples. Pitch marks come from channel 0 and are applied to every
 * channel, so a stereo take stays phase-coherent.
 */
export function applyPitchCorrection(
  buffer: AudioBuffer,
  strength: number,
  scale?: readonly number[],
  referenceA4 = 440,
): void {
  const clampedStrength = Math.min(1, Math.max(0, strength));
  if (clampedStrength <= 0) return;
  const sampleRate = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const track = trackPitch(data, sampleRate);
  const notes = segmentNotes(track, sampleRate, scale, referenceA4);
  if (notes.length === 0) return;
  const { shifts, active } = shiftTrack(track, notes, clampedStrength, sampleRate);
  if (!active.includes(1)) return;
  const frameOf = (sample: number) =>
    Math.min(
      shifts.length - 1,
      Math.max(0, Math.round((sample - track.frameSize / 2) / track.hop)),
    );
  const shiftAt = (sample: number) => shifts[frameOf(sample)];
  const activeAt = (sample: number) => active[frameOf(sample)] === 1;
  const { marks, periods, voiced } = pitchMarks(track.filtered, sampleRate, track);

  // How much of each sample comes from the resynthesis: the active mask, edges ramped over ±5ms
  // (a moving average over prefix sums).
  const n = data.length;
  const radius = Math.round(0.005 * sampleRate);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + active[frameOf(i)];
  const mixAt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n, i + radius + 1);
    mixAt[i] = (prefix[hi] - prefix[lo]) / (hi - lo);
  }
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channel = buffer.getChannelData(ch);
    const shifted = psola(channel, marks, periods, voiced, shiftAt, activeAt);
    for (let i = 0; i < n; i++) channel[i] += (shifted[i] - channel[i]) * mixAt[i];
  }
}

/**
 * Fixed-ratio, duration-preserving pitch shift — grain-resample + overlap-add with one constant
 * ratio for the whole buffer instead of a per-frame ratio chasing a detected note. No pitch
 * detection needed, so it's cheap and exact: used to transpose a whole backing track by a fixed
 * number of semitones (a manual key change) rather than correct a vocal toward a note.
 */
export function shiftPitchSemitones(buffer: AudioBuffer, semitones: number): void {
  if (semitones === 0) return;
  const ratio = 2 ** (semitones / 12);
  const frameSize = frameSizeFor(buffer.sampleRate);
  const hop = Math.floor(frameSize / 2);
  const window = hannWindow(frameSize);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const n = input.length;
    const output = new Float32Array(n);
    for (let pos = 0; pos < n; pos += hop) {
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
