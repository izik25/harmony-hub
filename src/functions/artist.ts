import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, artistProfiles, artistSongs, artistShows } from "@/db/schema";
import { requireUserId } from "./auth";

type ArtistLinksInput = {
  genre: string;
  label: string;
  spotifyUrl: string;
  youtubeUrl: string;
  appleMusicUrl: string;
  soundcloudUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  websiteUrl: string;
  wikipediaUrl: string;
  ticketsUrl: string;
};

export const updateArtistLinks = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as ArtistLinksInput)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [existing] = await db
      .select({ id: artistProfiles.id })
      .from(artistProfiles)
      .where(eq(artistProfiles.userId, userId));

    if (existing) {
      const [updated] = await db
        .update(artistProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(artistProfiles.userId, userId))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(artistProfiles)
      .values({ userId, ...data })
      .returning();
    return created;
  });

async function requireArtistUserByHandle(handle: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle));
  if (!user) throw new Error("userNotFound");
  return user.id;
}

export const listArtistSongs = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { handle: string })
  .handler(async ({ data }) => {
    const artistUserId = await requireArtistUserByHandle(data.handle);
    return db
      .select()
      .from(artistSongs)
      .where(eq(artistSongs.artistUserId, artistUserId))
      .orderBy(asc(artistSongs.position), asc(artistSongs.createdAt));
  });

export const addArtistSong = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) =>
      input as {
        title: string;
        coverUrl?: string;
        releaseYear?: number;
        spotifyUrl?: string;
        youtubeUrl?: string;
        appleMusicUrl?: string;
      },
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    if (!data.title.trim()) throw new Error("songTitleRequired");
    const [created] = await db
      .insert(artistSongs)
      .values({
        artistUserId: userId,
        title: data.title.trim(),
        coverUrl: data.coverUrl ?? "",
        releaseYear: data.releaseYear,
        spotifyUrl: data.spotifyUrl ?? "",
        youtubeUrl: data.youtubeUrl ?? "",
        appleMusicUrl: data.appleMusicUrl ?? "",
      })
      .returning();
    return created;
  });

export const deleteArtistSong = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { id: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await db
      .delete(artistSongs)
      .where(and(eq(artistSongs.id, data.id), eq(artistSongs.artistUserId, userId)));
    return { ok: true };
  });

export const listArtistShows = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { handle: string })
  .handler(async ({ data }) => {
    const artistUserId = await requireArtistUserByHandle(data.handle);
    return db
      .select()
      .from(artistShows)
      .where(eq(artistShows.artistUserId, artistUserId))
      .orderBy(asc(artistShows.position), asc(artistShows.showDate));
  });

export const addArtistShow = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) =>
      input as {
        title: string;
        venue?: string;
        city?: string;
        showDate?: string;
        ticketUrl?: string;
      },
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    if (!data.title.trim()) throw new Error("showTitleRequired");
    const [created] = await db
      .insert(artistShows)
      .values({
        artistUserId: userId,
        title: data.title.trim(),
        venue: data.venue ?? "",
        city: data.city ?? "",
        showDate: data.showDate ? new Date(data.showDate) : undefined,
        ticketUrl: data.ticketUrl ?? "",
      })
      .returning();
    return created;
  });

export const deleteArtistShow = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { id: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await db
      .delete(artistShows)
      .where(and(eq(artistShows.id, data.id), eq(artistShows.artistUserId, userId)));
    return { ok: true };
  });
