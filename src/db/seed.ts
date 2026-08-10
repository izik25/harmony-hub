import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./client";
import { users, posts, giftsCatalog, competitions, auditions } from "./schema";

const avatar = (seed: string) => `https://api.dicebear.com/9.x/glass/svg?seed=${seed}`;
const cover = (s: string) => `https://picsum.photos/seed/${s}/720/1280`;

async function main() {
  console.log("Seeding gifts catalog...");
  await db
    .insert(giftsCatalog)
    .values([
      { id: "g1", key: "rose", emoji: "🌹", coins: 10 },
      { id: "g2", key: "mic", emoji: "🎤", coins: 50 },
      { id: "g3", key: "disc", emoji: "💿", coins: 200 },
      { id: "g4", key: "diamond", emoji: "💎", coins: 500 },
      { id: "g5", key: "crown", emoji: "👑", coins: 1200 },
      { id: "g6", key: "rocket", emoji: "🚀", coins: 3000 },
    ])
    .onConflictDoNothing();

  console.log("Seeding demo users...");
  const demoPasswordHash = await bcrypt.hash("demo1234", 10);
  const demoUsers = [
    {
      handle: "novaray",
      name: "Nova Ray",
      email: "nova@demo.sona",
      verified: true,
      voiceType: "Alto · Pop",
      country: "IL",
      openToLabel: true,
      seed: "nova",
    },
    {
      handle: "kaiaster",
      name: "Kai Aster",
      email: "kai@demo.sona",
      verified: false,
      voiceType: "Baritone · R&B",
      country: "US",
      openToLabel: true,
      seed: "kai",
    },
    {
      handle: "djnyx",
      name: "DJ Nyx",
      email: "nyx@demo.sona",
      verified: true,
      voiceType: "DJ",
      country: "UK",
      openToLabel: false,
      seed: "nyx",
    },
    {
      handle: "lilamoon",
      name: "Lila Moon",
      email: "lila@demo.sona",
      verified: true,
      voiceType: "Soprano · Alt",
      country: "UK",
      openToLabel: true,
      seed: "lila",
    },
    {
      handle: "atlasvex",
      name: "Atlas Vex",
      email: "atlas@demo.sona",
      verified: false,
      voiceType: "Tenor · Rock",
      country: "CA",
      openToLabel: false,
      seed: "atlas",
    },
  ];

  const insertedUsers = await db
    .insert(users)
    .values(
      demoUsers.map((u) => ({
        handle: u.handle,
        name: u.name,
        email: u.email,
        passwordHash: demoPasswordHash,
        avatarUrl: avatar(u.seed),
        bio: "Demo artist account seeded for SONA.",
        verified: u.verified,
        voiceType: u.voiceType,
        country: u.country,
        openToLabel: u.openToLabel,
      })),
    )
    .onConflictDoNothing()
    .returning();

  const byHandle = new Map(insertedUsers.map((u) => [u.handle, u]));
  // If users already existed (re-run), fetch them so seeding posts still works.
  const allUsers = insertedUsers.length ? insertedUsers : await db.select().from(users);
  const find = (handle: string) =>
    byHandle.get(handle) ?? allUsers.find((u) => u.handle === handle);

  console.log("Seeding demo posts...");
  const nova = find("novaray");
  const kai = find("kaiaster");
  const nyx = find("djnyx");
  const lila = find("lilamoon");
  const atlas = find("atlasvex");

  if (nova && kai && nyx && lila && atlas) {
    await db.insert(posts).values([
      {
        userId: nova.id,
        type: "cover",
        title: "Cover of a classic",
        songTitle: "Blinding Lights — The Weeknd",
        hue: 320,
        coverUrl: cover("nova1"),
        tags: ["#neonpop", "#cover"],
        category: "Pop",
        credits: {
          performer: "Nova Ray",
          writer: "A. Tesfaye",
          composer: "M. Quenneville",
          producer: "Max Martin",
        },
        likesCount: 128400,
        commentsCount: 2340,
        sharesCount: 890,
        giftsCount: 421,
      },
      {
        userId: kai.id,
        type: "competition",
        title: "Semifinal round entry",
        songTitle: "Original — Neon Skies",
        hue: 280,
        coverUrl: cover("kai1"),
        tags: ["#originalsong", "#battle24"],
        category: "Pop",
        credits: {
          performer: "Kai Aster",
          writer: "Kai Aster",
          composer: "Kai Aster",
          producer: "Zen Lab",
        },
        likesCount: 54320,
        commentsCount: 1204,
        sharesCount: 210,
        giftsCount: 88,
      },
      {
        userId: nyx.id,
        type: "djset",
        title: "Midnight rooftop set",
        songTitle: "DJ Nyx — Midnight Rooftop",
        hue: 200,
        coverUrl: cover("nyx1"),
        tags: ["#djset", "#midnightcover"],
        category: "Electronic",
        credits: { performer: "DJ Nyx", writer: "—", composer: "DJ Nyx", producer: "DJ Nyx" },
        likesCount: 88120,
        commentsCount: 502,
        sharesCount: 1210,
        giftsCount: 302,
      },
      {
        userId: lila.id,
        type: "teaser",
        title: "New single drops Friday",
        songTitle: "Teaser — Velvet Static",
        hue: 340,
        coverUrl: cover("lila1"),
        tags: ["#studio"],
        category: "Pop",
        credits: {
          performer: "Lila Moon",
          writer: "L. Moon / R. Vale",
          composer: "L. Moon",
          producer: "R. Vale",
        },
        likesCount: 33210,
        commentsCount: 809,
        sharesCount: 402,
        giftsCount: 133,
      },
      {
        userId: atlas.id,
        type: "original",
        title: "Studio session — take 3",
        songTitle: "Original — Gold Circuit",
        hue: 250,
        coverUrl: cover("atlas1"),
        tags: ["#originalsong", "#autotune"],
        category: "Rock",
        credits: {
          performer: "Atlas Vex",
          writer: "Atlas Vex",
          composer: "Atlas Vex",
          producer: "Skyline",
        },
        likesCount: 21100,
        commentsCount: 320,
        sharesCount: 88,
        giftsCount: 44,
      },
    ]);
  }

  console.log("Seeding competitions...");
  await db.insert(competitions).values([
    {
      title: "Global Voice 2026",
      stage: "final",
      status: "active",
      prize: "$50,000",
      coverSeed: "comp1",
      hue: 320,
    },
    {
      title: "Cover Wars — Season 4",
      stage: "semi",
      status: "active",
      prize: "$12,000",
      coverSeed: "comp2",
      hue: 280,
    },
    {
      title: "Original Songwriting Cup",
      stage: "quarter",
      status: "upcoming",
      prize: "$8,000",
      coverSeed: "comp3",
      hue: 200,
    },
    {
      title: "DJ Battle Underground",
      stage: "quarter",
      status: "active",
      prize: "$5,000",
      coverSeed: "comp4",
      hue: 250,
    },
  ]);

  console.log("Seeding auditions...");
  if (nova) {
    await db.insert(auditions).values([
      {
        labelUserId: nova.id,
        title: "Signing 2 pop artists — advance + royalties",
        description: "NightGlow Records is looking for fresh pop voices.",
      },
      {
        labelUserId: nova.id,
        title: "Looking for female topline writer",
        description: "Sunset Publishing needs a topline writer for upcoming releases.",
      },
    ]);
  }

  console.log("Done seeding.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
