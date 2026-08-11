import "dotenv/config";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readdir, copyFile, unlink, access, readFile } from "node:fs/promises";
import { eq, notInArray } from "drizzle-orm";
import { put, head, del } from "@vercel/blob";
import { db } from "./client";
import { karaokeTracks } from "./schema";

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

async function ensureServed(file: string): Promise<string> {
  const served = safeFilename(file);

  if (USE_BLOB) {
    const pathname = `karaoke/${served}`;
    try {
      const info = await head(pathname);
      return info.url;
    } catch {
      const buffer = await readFile(path.join(KARAOKE_DIR, file));
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
    await copyFile(path.join(KARAOKE_DIR, file), servedPath);
  }
  return `/karaoke/files/${served}`;
}

async function main() {
  await mkdir(KARAOKE_DIR, { recursive: true });
  if (!USE_BLOB) await mkdir(SERVED_DIR, { recursive: true });
  const entries = await readdir(KARAOKE_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".mp4"))
    .map((e) => e.name);

  if (files.length === 0) {
    console.log(`No .mp4 files found in ${KARAOKE_DIR}`);
    console.log(
      'Drop karaoke videos there, named like "Artist - Song Title.mp4", then re-run this.',
    );
  }
  console.log(`Uploading via: ${USE_BLOB ? "Vercel Blob" : "local public/karaoke/files/"}\n`);

  const videoUrls: Array<string> = [];
  let added = 0;
  for (const file of files) {
    const videoUrl = await ensureServed(file);
    videoUrls.push(videoUrl);

    const [existing] = await db
      .select({ id: karaokeTracks.id })
      .from(karaokeTracks)
      .where(eq(karaokeTracks.videoUrl, videoUrl));
    if (existing) continue;
    const { title, artist } = parseFilename(file);
    await db.insert(karaokeTracks).values({ title, artist, videoUrl });
    added++;
    console.log(`+ added: ${artist ? `${artist} — ` : ""}${title}`);
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
    `\nDone. ${added} added, ${removed.length} removed, ${files.length} total in folder.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
