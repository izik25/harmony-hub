import "dotenv/config";
import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { eq, notInArray } from "drizzle-orm";
import { db } from "./client";
import { karaokeTracks } from "./schema";

const KARAOKE_DIR = path.join(process.cwd(), "public", "karaoke");

function parseFilename(filename: string): { title: string; artist: string } {
  const base = filename.replace(/\.mp4$/i, "");
  const parts = base.split(" - ");
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }
  return { artist: "", title: base.trim() };
}

async function main() {
  await mkdir(KARAOKE_DIR, { recursive: true });
  const files = (await readdir(KARAOKE_DIR)).filter((f) => f.toLowerCase().endsWith(".mp4"));

  if (files.length === 0) {
    console.log(`No .mp4 files found in ${KARAOKE_DIR}`);
    console.log(
      'Drop karaoke videos there, named like "Artist - Song Title.mp4", then re-run this.',
    );
  }

  const videoUrls = files.map((f) => `/karaoke/${f}`);

  let added = 0;
  for (const file of files) {
    const videoUrl = `/karaoke/${file}`;
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
        .returning({ title: karaokeTracks.title })
    : await db.delete(karaokeTracks).returning({ title: karaokeTracks.title });
  for (const r of removed) console.log(`- removed (file missing): ${r.title}`);

  console.log(
    `\nDone. ${added} added, ${removed.length} removed, ${files.length} total in folder.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
