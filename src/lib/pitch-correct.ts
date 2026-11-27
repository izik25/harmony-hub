// Real pitch detection + correction — the engine behind studio.tsx's "Autotune" slider and AI
// mastering's automatic tuning. A live Tone.PitchShift can only apply one fixed shift to the whole
// signal, so this works offline on the loaded buffer instead: track the sung pitch (YIN), split it
// into notes the way a pitch editor does, move each note's center toward its target and pull in
// slow drift while leaving vibrato and note attacks as sung — or, at the top of the slider, snap
// everything flat for the robotic hard-tune effect (see shiftTrack) — then resynthesize with
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
  /** Sung pitch per frame (detection jitter smoothed out, see JITTER_RADIUS_SEC), semitones from
   * A4. */
  semis: number[];
  /** Median sung pitch over the note, semitones from A4. */
  centerSemis: number;
  /** Where the note should be (see targetNoteFreq), semitones from A4. */
  targetSemis: number;
};

/** Frame-to-frame detection jitter on a phone take runs ~30-40 cents per 10ms frame at the 90th
 * percentile — far faster than any voice actually moves (a wide vibrato peaks around 10). A ±30ms
 * triangular smoothing takes it out while passing a 5-6Hz vibrato at over 90%. */
const JITTER_RADIUS_SEC = 0.03;
/** A run shorter than this is a passing pitch (a glide through it, a scoop), not a note. */
const MIN_NOTE_SEC = 0.06;

/** Moving average over ±radius, clipped at the ends. */
function boxSmooth(values: ArrayLike<number>, radius: number): Float64Array {
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

/**
 * Splits the pitch track into notes the way a pitch editor's "blobs" do: a run of voiced frames
 * that stays near its own center. Vibrato (a fast swing of up to about a semitone around the
 * note) stays inside one note; a jump to a new pitch (over half a semitone in one frame), or
 * drifting more than ~0.9 semitone from where the run has been, starts the next one. That's read
 * on the pitch with detection jitter smoothed out (see JITTER_RADIUS_SEC) — on the raw track,
 * jitter alone crossed the half-semitone line often enough to cut a phone take's singing into
 * ~130ms pieces, too short for any correction to settle on. Runs under MIN_NOTE_SEC are passing
 * pitches, not notes.
 */
function segmentNotes(
  track: PitchTrack,
  sampleRate: number,
  scale: readonly number[] | undefined,
  referenceA4: number,
): Note[] {
  const frameSec = track.hop / sampleRate;
  const jitterRadius = Math.max(1, Math.round(JITTER_RADIUS_SEC / frameSec));
  const minFrames = Math.ceil(MIN_NOTE_SEC / frameSec);
  const notes: Note[] = [];
  const n = track.f0.length;
  for (let a = 0; a < n;) {
    if (track.f0[a] == null) {
      a++;
      continue;
    }
    let b = a;
    while (b < n && track.f0[b] != null) b++;
    const raw = track.f0.slice(a, b).map((f) => toSemis(f as number, referenceA4));
    // Triangular = a box of a box.
    const half = Math.max(1, Math.round(jitterRadius / 2));
    const smooth = boxSmooth(boxSmooth(raw, half), half);
    let runStart = 0;
    let runSum = 0;
    for (let k = 0; k <= smooth.length; k++) {
      const ends =
        k === smooth.length ||
        (k > runStart &&
          (Math.abs(smooth[k] - smooth[k - 1]) > 0.5 ||
            Math.abs(smooth[k] - runSum / (k - runStart)) > 0.9));
      if (ends) {
        if (k - runStart >= minFrames) {
          const semis = Array.from(smooth.subarray(runStart, k));
          const sorted = [...semis].sort((x, y) => x - y);
          const centerSemis = sorted[Math.floor(sorted.length / 2)];
          notes.push({
            start: a + runStart,
            end: a + k,
            semis,
            centerSemis,
            targetSemis: toSemis(
              targetNoteFreq(referenceA4 * 2 ** (centerSemis / 12), scale, referenceA4),
              referenceA4,
            ),
          });
        }
        runStart = k;
        runSum = 0;
      }
      if (k < smooth.length) runSum += smooth[k];
    }
    a = b;
  }
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
  return analyzePitchData(buffer.getChannelData(0), buffer.sampleRate, scale, referenceA4);
}

/** analyzePitch on one raw channel — the form a worker can run (no AudioBuffer there). */
export function analyzePitchData(
  data: Float32Array,
  sampleRate: number,
  scale?: readonly number[],
  referenceA4 = 440,
): PitchProfile {
  const track = trackPitch(data, sampleRate);
  const notes = segmentNotes(track, sampleRate, scale, referenceA4);
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
 * Per-frame pitch shift (semitones) for a take — the tight, polished tuning of a modern pop lead
 * (an Auto-Tune retune speed of ~20-40ms with the singer's vibrato kept, or Melodyne with pitch
 * center at 100% and drift pulled in), not "snap every frame to the grid," which is the robotic
 * effect:
 *  - each note's center is moved onto its target — all the way from FULL_CENTER_AT strength up,
 *    proportionally below it — phased in from ~1 cent off, fully by ~5, so every take comes out on
 *    the grid;
 *  - short notes (runs, melisma, ~60-120ms) get 70-100%: a fast passage left out of tune is what
 *    kept a phone take sounding untuned;
 *  - slow wandering within a note (drift, smoothed over ±100ms — about one 5-6Hz vibrato cycle,
 *    so vibrato averages out of it) is pulled back toward the note's center (up to DRIFT_MAX);
 *  - what's faster than that — vibrato, wobble — is narrowed by TIGHT_MAX (the "locked" sound of a
 *    tuned pop vocal) but kept, so the voice still moves like a voice;
 *  - drift and narrowing are eased in over each note's first ATTACK_SEC, the scoop into it;
 *  - voiced frames between notes in one phrase (glides, passing pitches) take a shift interpolated
 *    from the notes either side, and the ends of a phrase hold its nearest note's — so a phrase
 *    is moved as one continuous line, with no jump back to the untouched voice mid-word;
 *  - the shift moves between notes with a retune-speed time constant (~25ms at the 0.8-0.9 AI
 *    mastering uses, slower below), so note changes are quick but still glide.
 * A phrase whose shift never reaches MIN_CORRECTION isn't touched at all. `active` marks the
 * frames being moved.
 *
 * Over the top of the slider (HARD_TUNE_FROM → 1) all of that crossfades into hard-tune, the
 * deliberate robotic effect: every voiced frame — vibrato, scoops, glides, short notes, notes
 * already in tune — is snapped to its own note, and the retune speed drops to zero so note changes
 * jump instead of gliding. At 1 the output pitch is flat on the grid, stepping between notes.
 */
function shiftTrack(
  track: PitchTrack,
  notes: Note[],
  strength: number,
  sampleRate: number,
  scale: readonly number[] | undefined,
  referenceA4: number,
) {
  const n = track.f0.length;
  // `raw`: each note's center shift (and the fill between notes), which the retune speed below
  // glides between. `detail`: the in-note drift/narrowing, added after — already smooth, and
  // running it through the retune smoothing too delayed it by a good part of a vibrato cycle, so
  // it landed late and narrowed far less than it should.
  const raw = new Float32Array(n).fill(NaN);
  const detail = new Float32Array(n);
  const active = new Uint8Array(n);
  const frameSec = track.hop / sampleRate;
  const driftRadius = Math.max(1, Math.round(DRIFT_RADIUS_SEC / frameSec));
  const attackFrames = ATTACK_SEC / frameSec;
  const centerAmount = Math.min(1, strength / FULL_CENTER_AT);
  const driftAmount = DRIFT_MAX * Math.min(1, strength / FULL_DRIFT_AT);
  const tight = TIGHT_MAX * smoothstep(0.4, FULL_DRIFT_AT, strength);

  for (const note of notes) {
    const { semis } = note;
    const error = note.targetSemis - note.centerSemis;
    const lengthScale = 0.7 + 0.3 * smoothstep(0.06, 0.12, semis.length * frameSec);
    const centerShift =
      error * centerAmount * lengthScale * smoothstep(0.01, 0.05, Math.abs(error));
    const slow = boxSmooth(semis, driftRadius);
    for (let i = 0; i < semis.length; i++) {
      const wander = slow[i] - note.centerSemis;
      const drift = wander * smoothstep(0.03, 0.08, Math.abs(wander));
      const fast = semis[i] - slow[i];
      const attack = smoothstep(0, attackFrames, i);
      // Eased back out over the note's last ~30ms, so the shift doesn't step where it ends.
      const release = smoothstep(0, attackFrames * 0.6, semis.length - 1 - i);
      raw[note.start + i] = centerShift;
      detail[note.start + i] =
        -(drift * driftAmount + fast * tight) * lengthScale * attack * release;
    }
  }

  // Fill each voiced phrase between and around its notes (see above); phrases with nothing to
  // move stay untouched.
  for (let a = 0; a < n;) {
    if (track.f0[a] == null) {
      raw[a] = 0;
      a++;
      continue;
    }
    let b = a;
    while (b < n && track.f0[b] != null) b++;
    let prev = -1;
    let largest = 0;
    for (let i = a; i < b; i++) {
      if (Number.isNaN(raw[i])) continue;
      largest = Math.max(largest, Math.abs(raw[i]), Math.abs(detail[i]));
      if (prev < 0) raw.fill(raw[i], a, i);
      else
        for (let k = prev + 1; k < i; k++)
          raw[k] = raw[prev] + ((raw[i] - raw[prev]) * (k - prev)) / (i - prev);
      prev = i;
    }
    if (prev < 0 || largest < MIN_CORRECTION) {
      raw.fill(0, a, b);
      detail.fill(0, a, b);
    } else {
      raw.fill(raw[prev], prev + 1, b);
      active.fill(1, a, b);
    }
    a = b;
  }

  const hard = smoothstep(HARD_TUNE_FROM, 1, strength);
  if (hard > 0) {
    // Inside a note, the snap target is the note's own — a wide vibrato swings past the halfway
    // point to the next semitone, and following it frame by frame would warble between the two.
    // Between notes (glides, scoops, blips too short to be one), each frame snaps on its own, held
    // until another note is clearly closer.
    const noteTarget = new Float32Array(n).fill(NaN);
    for (const note of notes) noteTarget.fill(note.targetSemis, note.start, note.end);
    let held: number | null = null;
    for (let i = 0; i < n; i++) {
      const f0 = track.f0[i];
      if (f0 == null) {
        held = null;
        continue;
      }
      const s = toSemis(f0, referenceA4);
      const candidate = Number.isNaN(noteTarget[i])
        ? toSemis(targetNoteFreq(f0, scale, referenceA4), referenceA4)
        : noteTarget[i];
      if (
        held == null ||
        !Number.isNaN(noteTarget[i]) ||
        Math.abs(s - candidate) < Math.abs(s - held) - HARD_TUNE_HYSTERESIS
      ) {
        held = candidate;
      }
      raw[i] += (held - s - raw[i]) * hard;
      active[i] = 1;
    }
  }

  const retuneMs = (60 - 45 * strength) * (1 - hard) + 0.5 * hard;
  const alpha = 1 - Math.exp(-(frameSec * 1000) / retuneMs);
  const shifts = new Float32Array(n);
  let state = 0;
  for (let i = 0; i < n; i++) {
    state += (raw[i] - state) * alpha;
    shifts[i] = state + detail[i] * (1 - hard);
    if (!active[i] && i > 0 && active[i - 1] && Math.abs(state) > 0.002) active[i] = 1;
  }
  return { shifts, active };
}

/** Semitones (2 cents): a note that would move less than this anywhere is left as sung — nobody
 * hears it, and resynthesizing it would only cost naturalness. */
const MIN_CORRECTION = 0.02;

/** Strength at which each note's center lands fully on its target (see shiftTrack). Under it the
 * center is moved proportionally. Tuning a note's center all the way is not what makes a voice
 * robotic — flattening its vibrato and snapping between notes is — and stopping short of it is
 * what left notes audibly off: a note sung 40 cents flat that still lands 15-20 off sounds just as
 * out of tune to a listener, so the correction never registered. */
const FULL_CENTER_AT = 0.7;
/** Drift: how much of a note's slow wander away from its center is pulled back (DRIFT_MAX, reached
 * at FULL_DRIFT_AT strength), smoothed over ±100ms — a ~200ms window spans about one cycle of a
 * 5-6Hz vibrato, so vibrato averages out of it while a slip that lasts a fifth of a second or more
 * shows up nearly in full. */
const DRIFT_MAX = 0.85;
const FULL_DRIFT_AT = 0.8;
const DRIFT_RADIUS_SEC = 0.1;
/** How much of a note's fast movement (vibrato, wobble — what's left after drift) is taken out at
 * AI mastering's strength. Auto-Tune at a pop retune speed (~20ms) passes a 5-6Hz vibrato at
 * about half its width; this lands about there. That narrowing — notes that sit "locked" while
 * still moving like a voice — is most of what makes a tuned vocal sound produced rather than
 * merely in tune; on real phone takes, whose notes swing a lot (p90 ~75 cents), moving only their
 * centers left the tuning all but inaudible. Kept well short of 1, the flat, robotic hard-tune. */
const TIGHT_MAX = 0.5;
/** Drift and narrowing ease in over a note's first 50ms — its scoop/attack, the singer's own. */
const ATTACK_SEC = 0.05;

/** Strength where hard-tune starts fading in (see shiftTrack). Above AI mastering's 0.8-0.9, so its
 * correction stays transparent; the slider's last stretch is the effect. */
const HARD_TUNE_FROM = 0.9;
/** Semitones: in hard-tune, how much closer another note must be before the snap moves to it. */
const HARD_TUNE_HYSTERESIS = 0.2;

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

/**
 * Pitch marks: one per glottal pulse through voiced stretches, and a fixed ~6ms step through
 * unvoiced ones. The first pulse of a stretch is the low-passed waveform's peak within one period;
 * each one after is wherever the waveform best matches the previous pulse's (normalized
 * cross-correlation, searched a quarter period either side of one period on) — so every grain is
 * cut at the same point of its cycle. Picking the highest peak there instead, as this used to, let
 * marks hop between the near-equal peaks a voice's harmonics put in each period, and each hop came
 * out as a jolt in the resynthesized pitch.
 *
 * The period each mark carries — what PSOLA spaces the output grains by — is the marks' own local
 * spacing (over ±MARK_PERIOD_SPAN pulses), not the pitch track's frame estimate: that estimate
 * jitters by tens of cents frame to frame on a phone take, and spacing grains by it wrote the
 * jitter into the output as a rough warble on every corrected note. Measured on real phone takes
 * shifted by a constant 30 cents: frames landing within ±10 cents of the shift went from 49-65% to
 * 81-89%.
 */
const MARK_PERIOD_SPAN = 2;

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
  const n = data.length;
  let t = 0;
  let lastVoiced = false;
  while (t < n) {
    const period = periodAt(t);
    if (period == null) {
      marks.push(t);
      periods.push(unvoicedStep);
      voiced.push(0);
      t += unvoicedStep;
      lastVoiced = false;
      continue;
    }
    let mark: number;
    if (!lastVoiced) {
      const hi = Math.min(n - 1, Math.round(t + period));
      mark = t;
      for (let i = t; i <= hi; i++) if (data[i] > data[mark]) mark = i;
    } else {
      const prev = marks[marks.length - 1];
      const half = Math.round(period / 2);
      const lo = Math.max(prev + 1, Math.round(t - period / 4));
      const hi = Math.min(n - 1 - half, Math.round(t + period / 4));
      mark = Math.max(lo, Math.min(t, hi));
      let best = -Infinity;
      for (let c = lo; c <= hi; c++) {
        let xy = 0;
        let yy = 0;
        for (let j = -half; j <= half; j++) {
          const p = prev + j;
          const x = p >= 0 ? data[p] : 0;
          const y = data[c + j] ?? 0;
          xy += x * y;
          yy += y * y;
        }
        const score = yy > 0 ? xy / Math.sqrt(yy) : -Infinity;
        if (score > best) {
          best = score;
          mark = c;
        }
      }
    }
    if (marks.length > 0 && mark <= marks[marks.length - 1]) mark = marks[marks.length - 1] + 1;
    marks.push(mark);
    periods.push(period);
    voiced.push(1);
    lastVoiced = true;
    t = mark + Math.round(period);
  }

  const span = MARK_PERIOD_SPAN;
  const trackPeriods = periods.slice();
  for (let k = span; k + span < marks.length; k++) {
    let allVoiced = true;
    for (let j = k - span; j <= k + span; j++) if (!voiced[j]) allVoiced = false;
    if (!allVoiced) continue;
    const local = (marks[k + span] - marks[k - span]) / (2 * span);
    // A mark that slipped a whole period (a missed or doubled pulse) would make this wildly off;
    // the track's estimate stands in there.
    if (Math.abs(local / trackPeriods[k] - 1) < 0.2) periods[k] = local;
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
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
    buffer.getChannelData(ch),
  );
  correctPitchChannels(channels, buffer.sampleRate, strength, scale, referenceA4);
}

/** applyPitchCorrection on raw channels, in place — the form a worker can run. */
export function correctPitchChannels(
  channels: Float32Array[],
  sampleRate: number,
  strength: number,
  scale?: readonly number[],
  referenceA4 = 440,
): void {
  const clampedStrength = Math.min(1, Math.max(0, strength));
  if (clampedStrength <= 0 || channels.length === 0) return;
  const data = channels[0];
  const track = trackPitch(data, sampleRate);
  const notes = segmentNotes(track, sampleRate, scale, referenceA4);
  if (notes.length === 0) return;
  const { shifts, active } = shiftTrack(
    track,
    notes,
    clampedStrength,
    sampleRate,
    scale,
    referenceA4,
  );
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
  for (const channel of channels) {
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

// ---- Off the main thread -----------------------------------------------------------------------
// Detection + PSOLA is plain number crunching over the whole take: on a 3-minute stereo take it's
// about a second per pass on a laptop and several on a phone, and AI mastering runs three passes
// back to back. On the main thread that froze the whole Studio (buttons, playback position, the
// step list) for that long. A GPU wouldn't buy much here — YIN's per-frame lag search and PSOLA's
// pitch-synchronous grains are sequential, data-dependent loops, not the wide uniform math a
// shader wants — so the win is a worker: same code, same result, the page stays responsive.

type PitchJob =
  | { op: "analyze"; data: Float32Array; sampleRate: number; scale?: number[]; referenceA4: number }
  | {
      op: "correct";
      channels: Float32Array[];
      sampleRate: number;
      strength: number;
      scale?: number[];
      referenceA4: number;
    };

/** Worker side: runs one job and posts the result back (channels transferred, not copied). */
export function runPitchJob(job: PitchJob): { result: unknown; transfer: Transferable[] } {
  if (job.op === "analyze") {
    return {
      result: analyzePitchData(job.data, job.sampleRate, job.scale, job.referenceA4),
      transfer: [],
    };
  }
  correctPitchChannels(job.channels, job.sampleRate, job.strength, job.scale, job.referenceA4);
  return { result: job.channels, transfer: job.channels.map((c) => c.buffer) };
}

function runOffThread<T>(job: PitchJob, transfer: Transferable[], fallback: () => T): Promise<T> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./pitch-correct.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return Promise.resolve(fallback());
  }
  return new Promise<T>((resolve) => {
    worker.onmessage = (e: MessageEvent<T>) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(fallback());
    };
    worker.postMessage(job, transfer);
  });
}

/** analyzePitch on a worker thread (a copy of channel 0 goes over; `buffer` isn't touched). */
export function analyzePitchOffThread(
  buffer: AudioBuffer,
  scale?: readonly number[],
  referenceA4 = 440,
): Promise<PitchProfile> {
  const data = buffer.getChannelData(0).slice();
  return runOffThread<PitchProfile>(
    {
      op: "analyze",
      data,
      sampleRate: buffer.sampleRate,
      scale: scale ? [...scale] : undefined,
      referenceA4,
    },
    [data.buffer],
    () => analyzePitch(buffer, scale, referenceA4),
  );
}

/**
 * applyPitchCorrection on a worker thread. Works on copies and writes the corrected channels back
 * into `buffer` only if `commit()` (checked on arrival) still says yes — so a result that's been
 * overtaken (a newer slider value, AI mastering restarting, a different take loaded) never lands
 * on top of newer audio. Resolves true when it wrote.
 */
export async function applyPitchCorrectionOffThread(
  buffer: AudioBuffer,
  strength: number,
  scale?: readonly number[],
  referenceA4 = 440,
  commit: () => boolean = () => true,
): Promise<boolean> {
  if (Math.min(1, Math.max(0, strength)) <= 0) return commit();
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
    buffer.getChannelData(ch).slice(),
  );
  const corrected = await runOffThread<Float32Array[]>(
    {
      op: "correct",
      channels,
      sampleRate: buffer.sampleRate,
      strength,
      scale: scale ? [...scale] : undefined,
      referenceA4,
    },
    channels.map((c) => c.buffer),
    () => {
      const local = Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
        buffer.getChannelData(ch).slice(),
      );
      correctPitchChannels(local, buffer.sampleRate, strength, scale, referenceA4);
      return local;
    },
  );
  if (!commit()) return false;
  corrected.forEach((c, ch) => buffer.getChannelData(ch).set(c));
  return true;
}
