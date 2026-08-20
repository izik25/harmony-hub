import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "./client";
import { karaokeArtists } from "./schema";

// Placeholder portraits until real artist photos are uploaded — same dicebear pattern seed.ts
// already uses for demo user avatars, just a more face-like style since these render as a photo
// grid rather than small avatar bubbles.
const photo = (seed: string) => `https://api.dicebear.com/9.x/personas/svg?seed=${seed}`;

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
  console.log("Seeding karaoke artists...");

  await db
    .insert(karaokeArtists)
    .values(ARTISTS.map((name, i) => ({ name, imageUrl: photo(name), position: i })))
    .onConflictDoUpdate({
      target: karaokeArtists.name,
      set: { imageUrl: sql`excluded.image_url`, position: sql`excluded.position` },
    });

  for (const name of ARTISTS) console.log(`+ ${name}`);
  console.log(`\nDone. ${ARTISTS.length} artists seeded.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
