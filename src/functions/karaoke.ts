import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { karaokeArtists, karaokeTracks } from "@/db/schema";
import { requireUserId } from "./auth";

export const listKaraokeArtists = createServerFn({ method: "GET" }).handler(async () => {
  await requireUserId();
  return db
    .select({
      id: karaokeArtists.id,
      name: karaokeArtists.name,
      imageUrl: karaokeArtists.imageUrl,
      trackCount: sql<number>`count(${karaokeTracks.id})`.mapWith(Number),
    })
    .from(karaokeArtists)
    .leftJoin(karaokeTracks, eq(karaokeTracks.artist, karaokeArtists.name))
    .groupBy(karaokeArtists.id)
    .orderBy(asc(karaokeArtists.position), asc(karaokeArtists.name));
});

export const listKaraokeTracks = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { query?: string; artist?: string })
  .handler(async ({ data }) => {
    await requireUserId();
    const q = data.query?.trim();
    const conditions = [
      data.artist ? eq(karaokeTracks.artist, data.artist) : undefined,
      q
        ? or(ilike(karaokeTracks.title, `%${q}%`), ilike(karaokeTracks.artist, `%${q}%`))
        : undefined,
    ].filter(Boolean);
    return db
      .select()
      .from(karaokeTracks)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(karaokeTracks.createdAt));
  });
