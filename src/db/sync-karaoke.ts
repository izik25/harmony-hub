import "dotenv/config";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readdir, copyFile, unlink, access, readFile } from "node:fs/promises";
import { eq, notInArray } from "drizzle-orm";
import { put, head, del } from "@vercel/blob";
import { db } from "./client";
import { karaokeTracks } from "./schema";
import { isKaraokeLanguage, languageFromScript } from "../lib/karaoke-language";

const KARAOKE_DIR = path.join(process.cwd(), "public", "karaoke");
const SERVED_DIR = path.join(KARAOKE_DIR, "files");
// Vercel's static-file serving for public/ turned out unreliable for these videos — verified
// with repeated checks, the exact same nested path flipped between 200 and a 307-to-/login
// with no caching involved (X-Vercel-Cache: MISS on the failures), even for a renamed,
// no-underscore folder. Real object storage sidesteps the whole question, and it's the same
// store already used for recordings/uploads. Local dev (no token) keeps the old local-file
// behavior, since Vite's dev server serves public/ directly with none of this ambiguity.
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

function parseFilename(filename: string): { title: string; artist: string } {
  const base = filename.replace(/\.mp4$/i, "");
  const parts = base.split(" - ");
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }
  return { artist: "", title: base.trim() };
}

function safeFilename(originalName: string): string {
  const hash = createHash("sha1").update(originalName).digest("hex").slice(0, 20);
  return `${hash}.mp4`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// One .mp4 to sync. `file` is the bare filename (what the served name is hashed from, so moving a
// file into a language folder keeps its URL and its row); `source` is where it actually sits.
type KaraokeSource = { file: string; source: string; language: string };

// public/karaoke/<lang>/*.mp4 is sung in <lang>. Files loose in public/karaoke/ predate the
// folders: their language comes from the name's script (Hebrew letters → "he"), and Latin-script
// names default to English. Other subfolders (files/, _duplicates/) are never read.
async function collectSources(): Promise<Array<KaraokeSource>> {
  const isMp4 = (name: string) => name.toLowerCase().endsWith(".mp4");
  const sources: Array<KaraokeSource> = [];
  for (const entry of await readdir(KARAOKE_DIR, { withFileTypes: true })) {
    if (entry.isFile() && isMp4(entry.name)) {
      sources.push({
        file: entry.name,
        source: path.join(KARAOKE_DIR, entry.name),
        language: languageFromScript(entry.name) ?? "en",
      });
    } else if (entry.isDirectory() && isKaraokeLanguage(entry.name)) {
      const dir = path.join(KARAOKE_DIR, entry.name);
      for (const inner of await readdir(dir, { withFileTypes: true })) {
        if (!inner.isFile() || !isMp4(inner.name)) continue;
        sources.push({
          file: inner.name,
          source: path.join(dir, inner.name),
          language: entry.name,
        });
      }
    }
  }
  return sources;
}

async function ensureServed({ file, source }: KaraokeSource): Promise<string> {
  const served = safeFilename(file);

  if (USE_BLOB) {
    const pathname = `karaoke/${served}`;
    try {
      const info = await head(pathname);
      return info.url;
    } catch {
      const buffer = await readFile(source);
      const blob = await put(pathname, buffer, {
        access: "public",
        addRandomSuffix: false,
        contentType: "video/mp4",
      });
      return blob.url;
    }
  }

  const servedPath = path.join(SERVED_DIR, served);
  if (!(await exists(servedPath))) {
    await copyFile(source, servedPath);
  }
  return `/karaoke/files/${served}`;
}

async function main() {
  await mkdir(KARAOKE_DIR, { recursive: true });
  if (!USE_BLOB) await mkdir(SERVED_DIR, { recursive: true });
  const files = await collectSources();

  if (files.length === 0) {
    console.log(`No .mp4 files found in ${KARAOKE_DIR}`);
    console.log(
      'Drop karaoke videos into a language folder (e.g. public/karaoke/es/), named like "Artist - Song Title.mp4", then re-run this.',
    );
  }
  console.log(`Uploading via: ${USE_BLOB ? "Vercel Blob" : "local public/karaoke/files/"}\n`);

  const videoUrls: Array<string> = [];
  let added = 0;
  let relabeled = 0;
  for (const src of files) {
    const videoUrl = await ensureServed(src);
    videoUrls.push(videoUrl);

    const [existing] = await db
      .select({ id: karaokeTracks.id, language: karaokeTracks.language })
      .from(karaokeTracks)
      .where(eq(karaokeTracks.videoUrl, videoUrl));
    if (existing) {
      // Moving a file into a language folder relabels its existing row in place, so posts
      // already recorded over it keep pointing at the same track.
      if (existing.language !== src.language) {
        await db
          .update(karaokeTracks)
          .set({ language: src.language })
          .where(eq(karaokeTracks.id, existing.id));
        relabeled++;
        console.log(`~ ${src.file}: language ${existing.language || "(none)"} → ${src.language}`);
      }
      continue;
    }
    const { title, artist } = parseFilename(src.file);
    await db.insert(karaokeTracks).values({ title, artist, videoUrl, language: src.language });
    added++;
    console.log(`+ added [${src.language}]: ${artist ? `${artist} — ` : ""}${title}`);
  }

  const removed = videoUrls.length
    ? await db
        .delete(karaokeTracks)
        .where(notInArray(karaokeTracks.videoUrl, videoUrls))
        .returning({ title: karaokeTracks.title, videoUrl: karaokeTracks.videoUrl })
    : await db
        .delete(karaokeTracks)
        .returning({ title: karaokeTracks.title, videoUrl: karaokeTracks.videoUrl });
  for (const r of removed) {
    console.log(`- removed (file missing): ${r.title}`);
    if (USE_BLOB) {
      if (r.videoUrl.includes(".public.blob.vercel-storage.com/")) {
        await del(r.videoUrl).catch(() => {});
      }
      continue;
    }
    // Only ever delete our own managed copies under files/ — older rows (or anything else)
    // may point straight at a source file, and that must never be touched by cleanup.
    if (!r.videoUrl.startsWith("/karaoke/files/")) continue;
    const servedPath = path.join(process.cwd(), "public", r.videoUrl.replace(/^\//, ""));
    await unlink(servedPath).catch(() => {});
  }

  console.log(
    `\nDone. ${added} added, ${relabeled} relabeled, ${removed.length} removed, ${files.length} total.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
