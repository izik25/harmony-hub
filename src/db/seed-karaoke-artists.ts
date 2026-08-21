import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "./client";
import { karaokeArtists } from "./schema";

// Placeholder fallback for whenever Deezer has no match — same dicebear pattern seed.ts already
// uses for demo user avatars.
const placeholderPhoto = (seed: string) =>
  `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(seed)}`;

type DeezerArtist = { name: string; nb_fan: number; picture_xl: string };

// Deezer's public search API needs no auth/key and is meant for exactly this — third-party apps
// looking up an artist's photo by name. We take the highest-fan-count match rather than just the
// first result, since a same-named minor artist occasionally outranks the real one on relevance
// alone (verified by hand for all 10 names in this file — every top-fan match was correct).
async function fetchArtistPhoto(name: string): Promise<string | null> {
  const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<DeezerArtist> };
    if (!data.data?.length) return null;
    const best = data.data.reduce((a, b) => (b.nb_fan > a.nb_fan ? b : a));
    return best.picture_xl || null;
  } catch {
    return null;
  }
}

// Phase 1: 10 singers to prove out the artist-grid flow end-to-end. Add the rest of the roster
// here later — sync-karaoke.ts matches karaoke_tracks.artist to this table's `name` by plain text,
// so a singer can be added here (and shows up, with 0 songs) before any .mp4 exists for them yet.
const ARTISTS = [
  "איתי לוי",
  "עומר אדם",
  "אייל גולן",
  "שרית חדד",
  "נינט טייב",
  "עדן חסון",
  "סטטיק ובן אל תבורי",
  "נסרין קדרי",
  "קובי פרץ",
  "חנן בן ארי",
];

async function main() {
  console.log("Looking up real artist photos on Deezer...");
  const rows = await Promise.all(
    ARTISTS.map(async (name, i) => {
      const photo = await fetchArtistPhoto(name);
      console.log(photo ? `+ ${name} -> found photo` : `+ ${name} -> no match, using placeholder`);
      return { name, imageUrl: photo ?? placeholderPhoto(name), position: i };
    }),
  );

  console.log("\nSeeding karaoke artists...");
  await db
    .insert(karaokeArtists)
    .values(rows)
    .onConflictDoUpdate({
      target: karaokeArtists.name,
      set: { imageUrl: sql`excluded.image_url`, position: sql`excluded.position` },
    });

  console.log(`Done. ${rows.length} artists seeded.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
