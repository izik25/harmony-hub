import "dotenv/config";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db } from "./client";
import { users, posts } from "./schema";

// Generates short, fully original instrumental loops (synthesized here, no samples/copyrighted
// material involved) so the 5 seeded demo posts have something real to play in the feed instead
// of silence. Same storage fallback as uploads.ts/sync-karaoke.ts: real Blob store when a token
// is configured, local public/uploads/ otherwise.
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const SAMPLE_RATE = 32000;

// ---- tiny synth engine -----------------------------------------------------

const QUALITIES: Record<string, Array<number>> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  sus4: [0, 5, 7],
  power: [0, 7],
};

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

type ChordStep = { root: number; quality: keyof typeof QUALITIES; bars: number };
type Style = "pop" | "electronic" | "rock" | "ambient";

type TrackSpec = {
  handle: string;
  // Must match the seeded post's exact `title` (src/db/seed.ts) — demo accounts accumulate other
  // posts from manual/automated testing, so matching on userId alone can grab the wrong row.
  postTitle: string;
  bpm: number;
  chords: Array<ChordStep>;
  style: Style;
};

const TRACKS: Array<TrackSpec> = [
  {
    // Nova Ray — "Blinding Lights — The Weeknd" style cover: bright synthwave pop, Am-F-C-G.
    handle: "novaray",
    postTitle: "Cover of a classic",
    bpm: 128,
    style: "pop",
    chords: [
      { root: 57, quality: "min", bars: 2 },
      { root: 53, quality: "maj", bars: 2 },
      { root: 60, quality: "maj", bars: 2 },
      { root: 55, quality: "maj", bars: 2 },
    ],
  },
  {
    // Kai Aster — original "Neon Skies": moody minor-key electro-pop, Dm-Bb-F-C.
    handle: "kaiaster",
    postTitle: "Semifinal round entry",
    bpm: 100,
    style: "pop",
    chords: [
      { root: 50, quality: "min", bars: 2 },
      { root: 58, quality: "maj", bars: 2 },
      { root: 53, quality: "maj", bars: 2 },
      { root: 60, quality: "maj", bars: 2 },
    ],
  },
  {
    // DJ Nyx — "Midnight Rooftop" DJ set: four-on-the-floor electronic, Cm-Ab-Eb-Bb.
    handle: "djnyx",
    postTitle: "Midnight rooftop set",
    bpm: 126,
    style: "electronic",
    chords: [
      { root: 48, quality: "min", bars: 2 },
      { root: 56, quality: "maj", bars: 2 },
      { root: 51, quality: "maj", bars: 2 },
      { root: 58, quality: "maj", bars: 2 },
    ],
  },
  {
    // Lila Moon — "Velvet Static" teaser: sparse ambient pad, Fmaj7-Am7-Dm7-Gsus4.
    handle: "lilamoon",
    postTitle: "New single drops Friday",
    bpm: 72,
    style: "ambient",
    chords: [
      { root: 53, quality: "maj7", bars: 2 },
      { root: 57, quality: "min7", bars: 2 },
      { root: 50, quality: "min7", bars: 2 },
      { root: 55, quality: "sus4", bars: 2 },
    ],
  },
  {
    // Atlas Vex — "Gold Circuit": driving rock power chords, E5-D5-A5-B5.
    handle: "atlasvex",
    postTitle: "Studio session — take 3",
    bpm: 140,
    style: "rock",
    chords: [
      { root: 52, quality: "power", bars: 2 },
      { root: 50, quality: "power", bars: 2 },
      { root: 57, quality: "power", bars: 2 },
      { root: 59, quality: "power", bars: 2 },
    ],
  },
];

function synthKick(): Float32Array {
  const len = Math.floor(SAMPLE_RATE * 0.28);
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const freq = 150 * Math.exp(-t * 18) + 45;
    const env = Math.exp(-t * 14);
    buf[i] = Math.sin(2 * Math.PI * freq * t) * env;
  }
  return buf;
}

function synthSnare(): Float32Array {
  const len = Math.floor(SAMPLE_RATE * 0.18);
  const buf = new Float32Array(len);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 22);
    const white = Math.random() * 2 - 1;
    const hp = white - prev;
    prev = white;
    const tone = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) * 0.6;
    buf[i] = (hp * 0.7 + tone) * env;
  }
  return buf;
}

function synthHat(open: boolean): Float32Array {
  const len = Math.floor(SAMPLE_RATE * (open ? 0.16 : 0.05));
  const buf = new Float32Array(len);
  let prev = 0;
  const decay = open ? 10 : 32;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * decay);
    const white = Math.random() * 2 - 1;
    const hp = white - prev;
    prev = white;
    buf[i] = hp * env;
  }
  return buf;
}

function synthShaker(): Float32Array {
  const len = Math.floor(SAMPLE_RATE * 0.09);
  const buf = new Float32Array(len);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 16);
    const white = Math.random() * 2 - 1;
    const hp = white - prev;
    prev = white;
    buf[i] = hp * env;
  }
  return buf;
}

function mixIn(master: Float32Array, event: Float32Array, startSample: number, gain: number) {
  for (let i = 0; i < event.length && startSample + i < master.length; i++) {
    if (startSample + i < 0) continue;
    master[startSample + i] += event[i] * gain;
  }
}

function renderTrack(spec: TrackSpec): Float32Array {
  const beatDur = 60 / spec.bpm;
  const boundaries: Array<number> = [0];
  for (const c of spec.chords) boundaries.push(boundaries[boundaries.length - 1] + c.bars * 4);
  const totalBeats = boundaries[boundaries.length - 1];
  const totalSamples = Math.floor(totalBeats * beatDur * SAMPLE_RATE);
  const master = new Float32Array(totalSamples);

  const hasArp = spec.style !== "ambient";
  const padGain = spec.style === "ambient" ? 0.6 : spec.style === "rock" ? 0.5 : 0.48;
  const arpGain = spec.style === "electronic" ? 0.4 : 0.32;
  const bassGain = spec.style === "ambient" ? 0.28 : 0.52;

  // Continuous layers: pad + arpeggio + bass, sample by sample.
  for (let n = 0; n < totalSamples; n++) {
    const t = n / SAMPLE_RATE;
    const beatPos = t / beatDur;

    let chordIdx = 0;
    for (let i = 0; i < spec.chords.length; i++) {
      if (beatPos >= boundaries[i]) chordIdx = i;
    }
    const chord = spec.chords[chordIdx];
    const tones = QUALITIES[chord.quality].map((iv) => midiToFreq(chord.root + iv));

    // Smooth 15ms crossfade around each chord boundary to avoid clicks.
    let boundaryDist = Infinity;
    for (const b of boundaries)
      boundaryDist = Math.min(boundaryDist, Math.abs(beatPos - b) * beatDur);
    const boundaryEnv = Math.min(1, boundaryDist / 0.015);

    let pad = 0;
    for (let i = 0; i < tones.length; i++) {
      pad += Math.sin(2 * Math.PI * tones[i] * t + i);
      pad += 0.5 * Math.sin(2 * Math.PI * tones[i] * 1.003 * t + i);
    }
    pad = (pad / (tones.length * 1.5)) * padGain * boundaryEnv;

    let arp = 0;
    if (hasArp) {
      const eighthDur = beatDur / 2;
      const localArp = t % eighthDur;
      const arpIdx = Math.floor(t / eighthDur) % tones.length;
      const arpFreq = tones[arpIdx] * 2;
      const arpEnv = Math.exp(-localArp * 9);
      arp =
        (Math.sin(2 * Math.PI * arpFreq * t) + 0.3 * Math.sin(4 * Math.PI * arpFreq * t)) *
        arpEnv *
        arpGain;
    }

    const bassFreq = midiToFreq(chord.root - 12);
    const localBeat = t % beatDur;
    const bassEnv = spec.style === "ambient" ? 0.55 : 0.4 + 0.6 * Math.exp(-localBeat * 6);
    let bass = Math.sin(2 * Math.PI * bassFreq * t) * bassEnv * bassGain;
    if (spec.style === "rock")
      bass += 0.3 * Math.sin(4 * Math.PI * bassFreq * t) * bassEnv * bassGain;

    master[n] = pad + arp + bass;
  }

  // Percussive layer: discrete events mixed additively.
  const totalBars = totalBeats / 4;
  for (let bar = 0; bar < totalBars; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const beatTime = (bar * 4 + beat) * beatDur;
      const sample = Math.round(beatTime * SAMPLE_RATE);

      if (spec.style === "pop") {
        if (beat === 0 || beat === 2) mixIn(master, synthKick(), sample, 0.85);
        if (beat === 1 || beat === 3) mixIn(master, synthSnare(), sample, 0.55);
      } else if (spec.style === "electronic") {
        mixIn(master, synthKick(), sample, 0.95);
        if (beat === 1 || beat === 3) mixIn(master, synthSnare(), sample, 0.5);
      } else if (spec.style === "rock") {
        if (beat === 0 || beat === 2) mixIn(master, synthKick(), sample, 0.9);
        if (beat === 1 || beat === 3) mixIn(master, synthSnare(), sample, 0.7);
      }

      for (const sub of [0, 0.5]) {
        const subTime = beatTime + sub * beatDur;
        const subSample = Math.round(subTime * SAMPLE_RATE);
        if (spec.style === "pop") mixIn(master, synthHat(false), subSample, 0.16);
        else if (spec.style === "electronic")
          mixIn(master, synthHat(sub === 0.5), subSample, sub === 0.5 ? 0.22 : 0.14);
        else if (spec.style === "rock") mixIn(master, synthHat(false), subSample, 0.2);
        else if (spec.style === "ambient" && sub === 0.5 && beat % 2 === 1)
          mixIn(master, synthShaker(), subSample, 0.12);
      }
    }
  }

  // Light Schroeder-ish reverb send for a "produced" feel instead of dry synthesis.
  const delaysSec = [0.029, 0.037, 0.041, 0.053];
  const feedback = 0.35;
  const reverbMix = spec.style === "ambient" ? 0.28 : 0.16;
  const wet = new Float32Array(master.length);
  for (const d of delaysSec) {
    const delaySamples = Math.round(d * SAMPLE_RATE);
    const line = new Float32Array(master.length);
    for (let i = 0; i < master.length; i++) {
      const fed = i >= delaySamples ? line[i - delaySamples] * feedback : 0;
      line[i] = master[i] + fed;
    }
    for (let i = 0; i < master.length; i++) wet[i] += line[i] * (reverbMix / delaysSec.length);
  }
  for (let i = 0; i < master.length; i++) master[i] += wet[i];

  // Extra drive for rock, then normalize + soft-clip everything.
  if (spec.style === "rock") {
    for (let i = 0; i < master.length; i++) master[i] = Math.tanh(master[i] * 1.8);
  }
  let peak = 0;
  for (let i = 0; i < master.length; i++) peak = Math.max(peak, Math.abs(master[i]));
  const norm = peak > 0 ? 0.92 / peak : 1;
  for (let i = 0; i < master.length; i++) master[i] = Math.tanh(master[i] * norm * 1.1) * 0.95;

  return master;
}

function encodeWav(samples: Float32Array): Buffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

async function store(handle: string, buffer: Buffer): Promise<string> {
  const filename = `demo-cover-${handle}.wav`;
  if (USE_BLOB) {
    const blob = await put(filename, buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: "audio/wav",
    });
    return blob.url;
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

async function main() {
  console.log(
    `Synthesizing demo audio via: ${USE_BLOB ? "Vercel Blob" : "local public/uploads/"}\n`,
  );

  for (const spec of TRACKS) {
    const [user] = await db.select().from(users).where(eq(users.handle, spec.handle));
    if (!user) {
      console.log(`- skip ${spec.handle}: user not seeded yet (run npm run db:seed first)`);
      continue;
    }
    const [existingPost] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.userId, user.id), eq(posts.title, spec.postTitle)));
    if (!existingPost) {
      console.log(
        `- skip ${spec.handle}: no post titled "${spec.postTitle}" found (run npm run db:seed first)`,
      );
      continue;
    }

    const samples = renderTrack(spec);
    const wav = encodeWav(samples);
    const url = await store(spec.handle, wav);
    await db.update(posts).set({ audioUrl: url }).where(eq(posts.id, existingPost.id));

    const seconds = (samples.length / SAMPLE_RATE).toFixed(1);
    console.log(`+ ${spec.handle}: ${seconds}s loop -> ${url}`);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
