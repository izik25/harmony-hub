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
// An exact name match wins over fan count, though: searching "עופר לוי" otherwise returns the far
// bigger Offer Nissim. DEEZER_NAME gives the name to search for when Deezer lists the singer under
// a different spelling than the one on our files.
const DEEZER_NAME: Record<string, string> = {
  "עופר לוי": "Ofer Levi",
};

async function fetchArtistPhoto(name: string): Promise<string | null> {
  const query = DEEZER_NAME[name] ?? name;
  const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(query)}&limit=5`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<DeezerArtist> };
    if (!data.data?.length) return null;
    const exact = data.data.filter((a) => a.name.toLowerCase() === query.toLowerCase());
    const pool = exact.length ? exact : data.data;
    const best = pool.reduce((a, b) => (b.nb_fan > a.nb_fan ? b : a));
    return best.picture_xl || null;
  } catch {
    return null;
  }
}

// The roster, grouped by the language tab each singer appears under in the karaoke picker (keys
// are UI language codes — see LANGUAGES in lib/i18n.ts). sync-karaoke.ts matches
// karaoke_tracks.artist to this table's `name` by plain text, so a singer can be added here (and
// shows up, with 0 songs) before any .mp4 exists for them yet. Latin-script singers (English,
// Spanish, French…) need to be listed under their language: their name alone can't tell us.
const ARTISTS: Record<string, Array<string>> = {
  he: [
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
    "עדן בן זקן",
    "ששון שאולוב",
    "פאר טסי",
    "רואי אדם",
    "אודיה",
    "אופק אדנק",
    "בר צברי",
    "נדב חנציס",
    "עופר לוי",
  ],
  en: ["Billie Eilish"],
  es: ["Luis Fonsi"],
  fr: ["Stromae"],
  ru: ["Ласковый май"],
};

async function main() {
  console.log("Looking up real artist photos on Deezer...");
  // Position is the order within the singer's own language tab.
  const roster = Object.entries(ARTISTS).flatMap(([language, names]) =>
    names.map((name, position) => ({ name, language, position })),
  );
  const rows = await Promise.all(
    roster.map(async ({ name, language, position }) => {
      const photo = await fetchArtistPhoto(name);
      console.log(photo ? `+ ${name} -> found photo` : `+ ${name} -> no match, using placeholder`);
      return { name, language, imageUrl: photo ?? placeholderPhoto(name), position };
    }),
  );

  console.log("\nSeeding karaoke artists...");
  await db
    .insert(karaokeArtists)
    .values(rows)
    .onConflictDoUpdate({
      target: karaokeArtists.name,
      set: {
        imageUrl: sql`excluded.image_url`,
        position: sql`excluded.position`,
        language: sql`excluded.language`,
      },
    });

  console.log(`Done. ${rows.length} artists seeded.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
