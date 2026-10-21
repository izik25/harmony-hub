import type { PitchProfile } from "./pitch-correct";
import type { SongAnalysis } from "./song-analysis";
import { compressionGrDb, deEssGrDb, type MixSettings } from "./vocal-chain";

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
 * note lands in tune, not so much that the voice turns robotic. A clearly pitchy take gets 90%. */
export function pitchStrengthFor(pitch: PitchProfile): number {
  if (pitch.voicedRatio < 0.15 || pitch.noteCount < 3 || pitch.avgAbsCents < 5) return 0;
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
}): { settings: MixSettings; report: ReportLine[] } {
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

  // Compression: 3.5:1 for 3-6dB of gain reduction on loud phrases — more the more unevenly the
  // take was sung (gap between loud and soft phrases).
  const compGr = clamp(3 + (song.vocal.phraseSpreadDb - 8) * 0.2, 3, 6);
  report.push({ key: "studio.reportComp", values: { db: round1(compGr) } });

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

  // Plate reverb: ~1.2-1.8s for up-tempo pop, 2-3s for ballads, 20-40ms pre-delay so each word
  // starts dry, and a 10-20% send. A model-dried take needs the space put back (more in a sparse
  // arrangement); a raw take already carries its room and only gets a light plate.
  const bpm = song.tempoBpm;
  const tail = bpm ? clamp(2.4 - (bpm - 75) * 0.024, 1.2, 2.4) : 1.6;
  const preDelay = bpm ? clamp(60 / bpm / 16, 0.02, 0.04) : 0.03;
  const reverb = Math.round(
    isClean ? clamp(26 + (1 - density) * 16, 24, 40) : clamp(16 + (1 - density) * 8, 12, 24),
  );
  const tailText = tail.toFixed(1);
  const preMs = Math.round(preDelay * 1000);
  report.push(
    !isClean
      ? { key: "studio.reportReverbRaw", values: { tail: tailText, pre: preMs } }
      : bpm
        ? {
            key: "studio.reportReverbTempo",
            values: { bpm: Math.round(bpm), tail: tailText, pre: preMs },
          }
        : { key: "studio.reportReverb", values: { tail: tailText, pre: preMs } },
  );

  // Delay: a dotted eighth — the go-to pop vocal echo — low feedback, filtered behind the voice.
  // Only with a detected tempo; an echo off the beat is worse than none.
  const delayTime = bpm ? (60 / bpm) * 0.75 : base.delayTime;
  const delay = bpm ? Math.round(isClean ? clamp(14 + (1 - density) * 14, 12, 28) : 8) : 0;
  if (delay > 0) {
    report.push({ key: "studio.reportDelay", values: { ms: Math.round(delayTime * 1000) } });
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
      presenceDb,
      airDb,
      warmth,
      reverb,
      reverbSize: Math.round(((tail - 0.6) / 1.8) * 100),
      preDelay: Math.round(preDelay * 1000) / 1000,
      delay,
      delayTime: Math.round(delayTime * 1000) / 1000,
    },
    report,
  };
}

/** Streaming services normalize to about −14 LUFS with true peak under −1dB; mastering to that
 * keeps every post equally loud in the feed without crushing it. */
export const TARGET_LUFS = -14;

/**
 * Vocal/playback balance and master gain from rendered measurements: the processed vocal's
 * loudness (LUFS, rendered alone through the chain) against the backing's. Pop leads sit above
 * the music — measured on commercial records at about +1dB on average, more for clarity — so this
 * aims for +1.5 LU over a sparse arrangement up to +3 LU over a dense one. Master gain then takes
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
    gapDb = round1(1.5 + density * 1.5);
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
