import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { karaokeArtists, karaokeTracks, posts, users } from "@/db/schema";
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

// The "sound page" a tapped song in the feed opens — the track itself plus how many published
// posts were recorded over it, mirroring TikTok's sound-detail screen (see listKaraokeTrackPosts
// below for the actual videos grid, kept as a separate call so this one stays cheap for the
// "Use this sound" deep link into /record, which only needs the track row).
export const getKaraokeTrack = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { id: string })
  .handler(async ({ data }) => {
    await requireUserId();
    const [row] = await db
      .select({
        id: karaokeTracks.id,
        title: karaokeTracks.title,
        artist: karaokeTracks.artist,
        videoUrl: karaokeTracks.videoUrl,
        durationSeconds: karaokeTracks.durationSeconds,
        createdAt: karaokeTracks.createdAt,
        artistImageUrl: sql<string>`coalesce(${karaokeArtists.imageUrl}, '')`,
        usageCount: sql<number>`(
          select count(*) from ${posts}
          where ${posts.karaokeTrackId} = ${karaokeTracks.id}
            and ${posts.status} = 'published'
            and ${posts.visibility} = 'public'
        )`.mapWith(Number),
      })
      .from(karaokeTracks)
      .leftJoin(karaokeArtists, eq(karaokeArtists.name, karaokeTracks.artist))
      .where(eq(karaokeTracks.id, data.id));
    if (!row) throw new Error("karaokeTrackNotFound");
    return row;
  });

// The grid of published performances recorded over a given karaoke track — what the sound page
// shows below the "Use this sound" button.
export const listKaraokeTrackPosts = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { karaokeTrackId: string })
  .handler(async ({ data }) => {
    await requireUserId();
    const rows = await db
      .select({
        id: posts.id,
        hue: posts.hue,
        coverUrl: posts.coverUrl,
        videoUrl: posts.videoUrl,
        audioUrl: posts.audioUrl,
        likesCount: posts.likesCount,
        user: { id: users.id, name: users.name, handle: users.handle, avatarUrl: users.avatarUrl },
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.userId))
      .where(
        and(
          eq(posts.karaokeTrackId, data.karaokeTrackId),
          eq(posts.status, "published"),
          eq(posts.visibility, "public"),
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(60);
    return rows;
  });
