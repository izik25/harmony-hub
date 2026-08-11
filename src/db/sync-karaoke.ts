import "dotenv/config";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readdir, copyFile, unlink, access } from "node:fs/promises";
import { eq, notInArray } from "drizzle-orm";
import { db } from "./client";
import { karaokeTracks } from "./schema";

const KARAOKE_DIR = path.join(process.cwd(), "public", "karaoke");
// Hebrew/Unicode filenames aren't reliable as public URLs — they've been observed falling
// through Vercel's static-file routing (mismatched encoding/normalization between what's
// uploaded and what the browser requests), landing on the app's auth-gated catch-all instead
// of the file. Source files stay readable for you to manage; what's actually served is a
// stable ASCII filename derived from the original name, kept in this subfolder.
const SERVED_DIR = path.join(KARAOKE_DIR, "_served");

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

async function main() {
  await mkdir(KARAOKE_DIR, { recursive: true });
  await mkdir(SERVED_DIR, { recursive: true });
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

  const videoUrls = files.map((f) => `/karaoke/_served/${safeFilename(f)}`);

  let added = 0;
  for (const file of files) {
    const served = safeFilename(file);
    const servedPath = path.join(SERVED_DIR, served);
    if (!(await exists(servedPath))) {
      await copyFile(path.join(KARAOKE_DIR, file), servedPath);
    }

    const videoUrl = `/karaoke/_served/${served}`;
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
    : await db.delete(karaokeTracks).returning({ title: karaokeTracks.title, videoUrl: karaokeTracks.videoUrl });
  for (const r of removed) {
    console.log(`- removed (file missing): ${r.title}`);
    // Only ever delete our own managed copies under _served/ — older rows (or anything else)
    // may point straight at a source file, and that must never be touched by cleanup.
    if (!r.videoUrl.startsWith("/karaoke/_served/")) continue;
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
