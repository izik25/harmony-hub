import type { PitchProfile } from "./pitch-correct";
import type { SongAnalysis } from "./song-analysis";
import { compressionGrDb, deEssGrDb, levelerGrDb, type MixSettings } from "./vocal-chain";

/**
 * AI mastering's decisions, as pure functions of what was measured — Studio runs the analysis,
 * pitch correction and renders, these decide the numbers. Every range below is the standard
 * lead-vocal starting point from mixing references (cited per stage); the measurements decide
 * where inside that range this take lands, and anything that measured fine is left alone.
 *
 * Spectral comparisons are spectral-density differences (dB per FFT bin) against the vocal's own
 * 500Hz-2kHz body, with targets calibrated on real phone takes from this app (mud ≈ +8-11,
 * presence ≈ −13, air ≈ −13-19 on these scales).
 */

export type ReportLine = { key: string; values?: Record<string, string | number> };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Pitch-editor guidance is to start around 80% correction and adjust by ear — enough that every
 * note lands in tune, not so much that the voice turns robotic. A clearly pitchy take gets 90%.
 * At these strengths every note's center lands on its target, most of its drift is pulled in and
 * its vibrato is narrowed to about half — a pop retune speed — while note attacks stay as sung
 * (see shiftTrack in pitch-correct.ts). Every sung take gets it, however well it
 * measured — no take is dead-on everywhere, and whatever it did measure lands exactly on the note.
 * Only a take with little sustained pitch (spoken word, rap) is left alone. */
export function pitchStrengthFor(pitch: PitchProfile): number {
  if (pitch.voicedRatio < 0.15 || pitch.noteCount < 3) return 0;
  return pitch.avgAbsCents > 30 ? 0.9 : 0.8;
}

export function planProcessing({
  song,
  pitch,
  isClean,
  noiseFloorDb,
  base,
}: {
  song: SongAnalysis;
  pitch: PitchProfile;
  /** The take came back from the Replicate cleanup (dry, de-noised). */
  isClean: boolean;
  noiseFloorDb: number;
  base: MixSettings;
}): {
  settings: MixSettings;
  report: ReportLine[];
  /** Where the reverb should sit under the dry voice, LU. */
  reverbTargetLu: number;
  reverbReport: (lu: number) => ReportLine;
  /** Where the echo should sit under the dry voice, LU — null for no echo. */
  delayTargetLu: number | null;
  delayReport: (lu: number) => ReportLine;
} {
  const v = song.vocal.bands;
  const density = song.backing?.density ?? 0.5;
  const report: ReportLine[] = [];

  // High-pass: 80-100Hz for low voices, higher for high ones — always under the lowest note
  // actually sung (65% of it), so it takes rumble and plosive thump, never the voice. A raw take
  // in a noisy room leans on it harder, still never above 80% of that lowest note.
  const lowHz = pitch.lowHz;
  let hpfHz = lowHz ? clamp(lowHz * 0.65, 70, 150) : 90;
  if (!isClean && lowHz) {
    const roomHz = 50 + clamp(((noiseFloorDb + 55) / 30) * 100, 0, 100);
    hpfHz = clamp(Math.max(hpfHz, Math.min(roomHz, lowHz * 0.8)), 50, 150);
  }
  hpfHz = Math.round(hpfHz);
  report.push({ key: "studio.reportLowCut", values: { hz: hpfHz } });

  // Mud (200-500Hz): a narrow 2-4dB cut, only on the excess over a full-but-clear low-mid.
  const mudCutDb = round1(clamp((v.mud - v.body - 9) * 0.6, 0, 4));
  if (mudCutDb >= 1) report.push({ key: "studio.reportMud", values: { db: mudCutDb } });

  // De-esser: split-band, a few dB off the loudest "s" — always a little, since compression and
  // the air shelf below both lift sibilance; more on a take that's already sibilant. Crossover
  // lower for low voices (sibilance ~5-7kHz), higher for high ones (7-10kHz).
  const sibilanceExcess = v.sibilance - v.presence + 5;
  const deEssGr = clamp(3 + sibilanceExcess * 0.8, 2, 6);
  const deEssHz = lowHz && lowHz > 165 ? 7500 : 6000;
  report.push({ key: "studio.reportDeEss", values: { hz: deEssHz, db: round1(deEssGr) } });

  // Compression in two stages, the way a pop lead is compressed: a fast 3.5:1 for 3-5dB on the
  // loud phrases (more the more unevenly the take was sung), then a slow opto-style leveler for a
  // steady ~2.5dB more that evens out whole phrases — two moderate stages sound smoother than one
  // working hard. The phrase riding in vocal prep (vocal-prep.ts) has already closed part of the
  // gap between soft and loud lines before either.
  const compGr = clamp(3 + (song.vocal.phraseSpreadDb - 8) * 0.2, 3, 5);
  report.push({ key: "studio.reportComp", values: { db: round1(compGr) } });
  const levelerGr = 2.5;
  report.push({ key: "studio.reportLeveler", values: { db: levelerGr } });

  // Presence (~3kHz): +1-3dB where the voice lacks it, plus a little more where the arrangement is
  // itself presence-heavy relative to the voice (that's where it would cover the words).
  const presenceTilt = -11 - (v.presence - v.body);
  const maskShape = song.backing
    ? song.backing.bands.presence - song.backing.bands.body - (v.presence - v.body)
    : 0;
  const presenceDb = round1(clamp(presenceTilt * 0.4 + clamp(maskShape * 0.15, 0, 1.5), -2, 3));
  if (presenceDb >= 0.5) {
    report.push({
      key: maskShape > 2 ? "studio.reportMasking" : "studio.reportPresence",
      values: { db: presenceDb },
    });
  } else if (presenceDb <= -0.5) {
    report.push({ key: "studio.reportPresenceCut", values: { db: -presenceDb } });
  }

  // Air (10kHz+ shelf): +1-3dB on a dull take; never brighten an already-sibilant one.
  let airDb = clamp((-12 - (v.air - v.presence)) * 0.4, -2, 3);
  if (sibilanceExcess > 2) airDb = Math.min(airDb, 0.5);
  airDb = round1(airDb);
  if (airDb >= 0.5) report.push({ key: "studio.reportAir", values: { db: airDb } });
  else if (airDb <= -0.5) report.push({ key: "studio.reportDarken", values: { db: -airDb } });

  // Saturation: subtle, for density — more on a model-cleaned take, which comes back very clean.
  const warmth = isClean ? 25 : 12;
  report.push({ key: "studio.reportWarmth" });

  // Plate reverb: short tails (≈1.6s for a slow song down to 1.0s for a fast one — the lower
  // half of the usual pop range, since a long tail on a phone take reads as echo), 20-40ms
  // pre-delay so each word starts dry. How much is not guessed from a dial position: Studio renders
  // the take with and without it and sets the send so the reverb lands at a fixed loudness under
  // the dry voice (see reverbSendFor) — subtle, a little more over a sparse arrangement. A raw
  // take already carries its own room, so it gets far less.
  const bpm = song.tempoBpm;
  const tail = bpm ? clamp(1.6 - (bpm - 75) * 0.015, 1.0, 1.6) : 1.3;
  const preDelay = bpm ? clamp(60 / bpm / 16, 0.02, 0.04) : 0.03;
  // Subtle on purpose: listening tests have favored reverb as loud as ~9 LU under the dry voice,
  // but the voice is the product. When the export was mono, with a hissy noise tail folded onto
  // the center, anything over ~−25 LU read as "too much reverb"; the decorrelated stereo plate
  // spreads to the sides around the voice instead of over it, so it carries more space at the same
  // clarity — −25 LU over a dense arrangement up to −22 over a sparse one, where it's most exposed
  // yet also most needed to fill the gaps.
  // Set 1 LU wetter than that (−24 to −21) once the echo below was in, which adds its own depth,
  // for a little more of a produced, studio sound without the voice losing its front.
  const reverbTargetLu = isClean ? -24 + (1 - density) * 3 : -30;
  const tailText = tail.toFixed(1);
  const preMs = Math.round(preDelay * 1000);
  const reverbReport = (lu: number): ReportLine => {
    const values = { tail: tailText, pre: preMs, lu: Math.round(-lu) };
    if (!isClean) return { key: "studio.reportReverbRaw", values };
    return bpm
      ? { key: "studio.reportReverbTempo", values: { ...values, bpm: Math.round(bpm) } }
      : { key: "studio.reportReverb", values };
  };

  // Echo: a delay loud enough to hear as echo smears running lyrics, so this is the engineer's
  // "felt, not heard" ambience delay instead — a dotted eighth of the tempo (so its repeats land on
  // the groove), filtered 200Hz-5kHz in the chain, and measured in like the reverb (see
  // reverbSendFor) to sit ~30 LU under the voice, well below the reverb. A raw take already
  // carries its own room, and anything added on it read as echo, so it gets none.
  const delayTime = bpm ? clamp((60 / bpm) * 0.75, 0.25, 0.6) : base.delayTime;
  const delayTargetLu = isClean ? -30 + (1 - density) * 2 : null;
  if (delayTargetLu == null) report.push({ key: "studio.reportNoDelay" });
  const delayMs = Math.round(delayTime * 1000);
  const delayReport = (lu: number): ReportLine => ({
    key: "studio.reportDelay",
    values: { ms: delayMs, lu: Math.round(-lu) },
  });

  // Doubler: the micro-pitch-shift width of a produced lead. Both copies together ~17 LU under the
  // voice (a raw take, room and all, ~21) — measured on a rendered phone take: 32 lands at −17.3,
  // 20 at −21.4 — where the voice gets wider and fuller without the copies being heard as copies.
  const width = isClean ? 32 : 20;
  report.push({ key: "studio.reportWidth" });

  // Delay throws: an echo on the last word of each line, a quarter note long, repeating into the
  // pause after it — where pop mixes put their audible echo, instead of on every word. At 45 the
  // repeats measure ~19 LU under the voice where they sound. Not on a raw take, whose room already
  // echoes.
  const throwTime = bpm ? clamp(60 / bpm, 0.3, 0.8) : base.throwTime;
  const throws = isClean ? 45 : 0;
  if (throws > 0) {
    report.push({ key: "studio.reportThrows", values: { ms: Math.round(throwTime * 1000) } });
  }

  return {
    settings: {
      ...base,
      lowCut: hpfHz - 50,
      mudCutDb,
      deEss: Math.round((deEssGr / deEssGrDb(100)) * 100),
      // +3: the compressor reacts to the envelope's peaks, which ride a few dB over the frame
      // level measured here. Floored 28dB under the take's loud passages, so a take with almost no
      // sibilance can't put the threshold where it would squash every high in the voice.
      deEssRefDb: Math.max(song.vocal.sibilancePeakDb + 3, -18 - base.inputTrimDb - 28),
      deEssHz,
      compression: Math.round((compGr / compressionGrDb(100)) * 100),
      leveler: Math.round((levelerGr / levelerGrDb(100)) * 100),
      presenceDb,
      airDb,
      warmth,
      // A probe level; the real send is measured in (reverbSendFor).
      reverb: REVERB_PROBE,
      reverbSize: Math.round(((tail - 0.6) / 1.8) * 100),
      preDelay: Math.round(preDelay * 1000) / 1000,
      // A probe level when an echo is planned; the real send is measured in (reverbSendFor).
      delay: delayTargetLu == null ? 0 : REVERB_PROBE,
      delayTime: Math.round(delayTime * 1000) / 1000,
      width,
      throws,
      throwTime: Math.round(throwTime * 1000) / 1000,
    },
    report,
    reverbTargetLu,
    reverbReport,
    delayTargetLu,
    delayReport,
  };
}

export const REVERB_PROBE = 30;

/** The reverb send that puts the reverb at `targetLu` relative to the dry voice, given that the
 * send at REVERB_PROBE measured `probeLu` — the send is linear, so loudness moves 20·log10 with it. */
export function reverbSendFor(probeLu: number, targetLu: number): number {
  return Math.round(clamp(REVERB_PROBE * 10 ** ((targetLu - probeLu) / 20), 0, 60));
}

/** Streaming services normalize to about −14 LUFS with true peak under −1dB; mastering to that
 * keeps every post equally loud in the feed without crushing it. */
export const TARGET_LUFS = -14;

/**
 * Vocal/playback balance and master gain from rendered measurements: the processed vocal's
 * loudness (LUFS, rendered dry and alone through the chain) against the backing's. Pop leads sit
 * above the music — about +1dB on average on commercial records, but this is a singer showcasing a
 * performance over a full produced instrumental, where being heard clearly wins — so this aims for
 * +4 LU over a sparse arrangement up to +5.5 LU over a dense one. Master gain then takes
 * the sum to the target, capped so the limiter never has to take more than ~3dB off a peak (more
 * than that is where a limiter starts to audibly distort).
 */
export function planLevels({
  vocalLufs,
  backingLufs,
  density,
  base,
  mixPeakDbAt,
}: {
  vocalLufs: number;
  backingLufs: number | null;
  density: number;
  base: MixSettings;
  /** Peak (dBFS) of vocal·vocalLevel + backing·backingLevel, before master gain. */
  mixPeakDbAt: (vocalLevel: number, backingLevel: number) => number;
}): { settings: MixSettings; gapDb: number | null } {
  let vocalPct = base.vocalVolume;
  let playbackPct = base.playbackVolume;
  let gapDb: number | null = null;
  if (backingLufs != null) {
    gapDb = round1(4 + density * 1.5);
    const ratio = 10 ** ((gapDb - (vocalLufs - backingLufs)) / 20);
    // Vocal capped at 160% so the slider keeps headroom for a manual push; past that the
    // playback comes down instead.
    vocalPct = Math.round(clamp(95 * ratio, 50, 160));
    playbackPct = Math.round(clamp(vocalPct / ratio, 0, 150));
  }
  const vl = backingLufs != null ? vocalPct / 100 : 1;
  const bl = playbackPct / 100;
  const vocalAt = vocalLufs + 20 * Math.log10(vl);
  const mixLufs =
    backingLufs != null
      ? 10 *
        Math.log10(
          10 ** (vocalAt / 10) + 10 ** ((backingLufs + 20 * Math.log10(Math.max(bl, 1e-3))) / 10),
        )
      : vocalAt;
  const peakCap = -1 + 3 - mixPeakDbAt(vl, backingLufs != null ? bl : 0);
  const gainDb = round1(clamp(Math.min(TARGET_LUFS - mixLufs, peakCap), -12, 9));
  return {
    settings: { ...base, vocalVolume: vocalPct, playbackVolume: playbackPct, gainDb },
    gapDb,
  };
}
