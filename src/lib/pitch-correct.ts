// Real pitch detection + correction — the engine behind studio.tsx's "Autotune" slider and AI
// mastering's automatic tuning. A live Tone.PitchShift can only apply one fixed shift to the whole
// signal, so this works offline on the loaded buffer instead: track the sung pitch (autocorrelation,
// median-filtered against octave errors), split it into notes the way a pitch editor does, move
// each note's center toward its target and pull in slow drift while leaving vibrato as sung (see
// shiftTrack), then resynthesize with TD-PSOLA, which shifts pitch without moving the voice's
// formants (see psola). Studio bakes it in a beat after the slider stops moving, or immediately
// when AI mastering decides a take needs it.

const MIN_HZ = 80; // below typical low male singing range; also keeps the autocorrelation lag search short
const MAX_HZ = 900; // above typical high female/falsetto singing range
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
  silenceRms: number,
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
  if (rms < silenceRms) return null; // breath/room noise, not a note

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

/** Runs autocorrelate across the whole channel on a fixed hop, once — both analyzePitch and
 * applyPitchCorrection need this same raw per-frame pitch track before they can do anything else
 * with it (measure deviation, or median-filter + smooth it for correction). */
function detectPitchTrack(
  data: Float32Array,
  sampleRate: number,
  frameSize: number,
  hop: number,
  silenceRms: number,
): (number | null)[] {
  const track: (number | null)[] = [];
  for (let pos = 0; pos + frameSize <= data.length; pos += hop) {
    track.push(
      autocorrelate(data.subarray(pos, pos + frameSize), sampleRate, MIN_HZ, MAX_HZ, silenceRms),
    );
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

type PitchTrack = {
  frameSize: number;
  hop: number;
  /** Median-filtered f0 per frame (Hz), null where unvoiced. Frame i is centered on
   * i * hop + frameSize / 2. */
  f0: (number | null)[];
};

/** ~6ms hop: fine enough to follow vibrato and note onsets, which the per-note correction below
 * has to tell apart. */
function trackPitch(data: Float32Array, sampleRate: number): PitchTrack {
  const frameSize = frameSizeFor(sampleRate);
  const hop = Math.floor(frameSize / 4);
  const floor = silenceFloorFor(data, frameSize, hop);
  return {
    frameSize,
    hop,
    f0: medianFilterPitch(detectPitchTrack(data, sampleRate, frameSize, hop, floor)),
  };
}

const toSemis = (hz: number, referenceA4: number) => 12 * Math.log2(hz / referenceA4);

type Note = {
  /** Frame range [start, end). */
  start: number;
  end: number;
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
      notes.push({ start: runStart, end, centerSemis, targetSemis });
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

/**
 * Per-frame pitch shift (semitones) for a take, the way a pitch editor applies it — not "snap every
 * frame to the grid," which is what flattens a voice into the robotic effect:
 *  - each note's center is moved toward its target by `strength` (Melodyne's "pitch center");
 *  - slow wandering within a note (drift, the unintentional part — smoothed over ±90ms, wider than one 5-6Hz vibrato cycle) is pulled
 *    back toward the note's center by 70% of `strength` ("pitch drift");
 *  - anything faster than that — vibrato, the singer's own expression — is left exactly as sung;
 *  - the shift moves between notes with a retune-speed time constant (~20ms at full strength,
 *    ~30ms at the 0.8 AI mastering uses, slower below), so note changes glide instead of snapping.
 */
function shiftTrack(track: PitchTrack, notes: Note[], strength: number, sampleRate: number) {
  const n = track.f0.length;
  const raw = new Float32Array(n);
  const driftRadius = Math.max(1, Math.round((0.09 * sampleRate) / track.hop));
  for (const note of notes) {
    const semis: number[] = [];
    for (let i = note.start; i < note.end; i++) semis.push(toSemis(track.f0[i]!, 440));
    const centerShift = (note.targetSemis - note.centerSemis) * strength;
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
      const drift = sum / count - note.centerSemis;
      raw[note.start + i] = centerShift - drift * strength * 0.7;
    }
  }
  const retuneMs = 70 - 50 * strength;
  const alpha = 1 - Math.exp(-((track.hop / sampleRate) * 1000) / retuneMs);
  const out = new Float32Array(n);
  let state = 0;
  for (let i = 0; i < n; i++) {
    state += (raw[i] - state) * alpha;
    out[i] = state;
  }
  return out;
}

/**
 * TD-PSOLA (pitch-synchronous overlap-add) resynthesis. The voice is cut into two-period grains
 * centered on its own pitch pulses, and the grains are laid back down closer together (higher
 * pitch) or further apart (lower) — each grain itself is never resampled, so the vocal tract's
 * formants stay where they are and a shifted note still sounds like the same singer, without the
 * phasey warble of plain grain resampling. Unvoiced stretches use short fixed grains at their
 * original spacing, which reconstructs them unchanged.
 */
function psola(
  input: Float32Array,
  marks: Int32Array,
  periods: Float32Array,
  voiced: Uint8Array,
  ratioAt: (sample: number) => number,
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
    const dst = Math.round(ts);
    for (let j = -half; j <= half; j++) {
      const src = m + j;
      const d = dst + j;
      if (src < 0 || src >= n || d < 0 || d >= n) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * j) / half);
      out[d] += input[src] * w;
      weight[d] += w;
    }
    ts += voiced[k] ? period / ratioAt(dst) : period;
  }
  for (let i = 0; i < n; i++) out[i] = weight[i] > 1e-3 ? out[i] / Math.max(weight[i], 0.25) : 0;
  return out;
}

/** Pitch marks: one per glottal pulse through voiced stretches (each locked to the waveform peak
 * nearest one period on from the last, so grains line up in phase), and a fixed ~6ms step through
 * unvoiced ones. */
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
    // third of a period either side of where the next pulse should be.
    const lo = lastVoiced ? Math.round(t - period / 3) : t;
    const hi = Math.min(data.length - 1, Math.round(lastVoiced ? t + period / 3 : t + period));
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
 * shift (see shiftTrack), and resynthesize with PSOLA. `strength` is 0-1 — AI mastering uses 0.8,
 * the "natural but in tune" starting point pitch-editing guides recommend; 1 is full correction.
 * Notes are aimed at the song's scale when one is given (see targetNoteFreq). Pitch marks come
 * from channel 0 and are applied to every channel, so a stereo take stays phase-coherent.
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
  const shifts = shiftTrack(track, notes, clampedStrength, sampleRate);
  const ratioAt = (sample: number) => {
    const frame = Math.round((sample - track.frameSize / 2) / track.hop);
    const shift = shifts[Math.min(shifts.length - 1, Math.max(0, frame))] ?? 0;
    return 2 ** (shift / 12);
  };
  const { marks, periods, voiced } = pitchMarks(data, sampleRate, track);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channel = buffer.getChannelData(ch);
    channel.set(psola(channel, marks, periods, voiced, ratioAt));
  }
}

/**
 * Fixed-ratio, duration-preserving pitch shift — the same grain-resample + overlap-add engine as
 * applyPitchCorrection above, but with one constant ratio for the whole buffer instead of a
 * per-frame ratio chasing a detected note. No pitch detection needed, so it's cheap and exact:
 * used to transpose a whole backing track by a fixed number of semitones (a manual key change)
 * rather than correct a vocal toward the nearest chromatic note.
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
