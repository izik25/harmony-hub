import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, posts, follows, likes } from "@/db/schema";
import { requireUserId } from "./auth";

export const getProfileByHandle = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { handle: string })
  .handler(async ({ data }) => {
    const viewerId = await requireUserId();
    const [user] = await db.select().from(users).where(eq(users.handle, data.handle));
    if (!user) throw new Error("userNotFound");

    const [[followerCount], [followingCount], [likesTotal], [isFollowing]] = await Promise.all([
      db.select({ n: count() }).from(follows).where(eq(follows.followeeId, user.id)),
      db.select({ n: count() }).from(follows).where(eq(follows.followerId, user.id)),
      db
        .select({ n: sql<number>`coalesce(sum(${posts.likesCount}), 0)`.mapWith(Number) })
        .from(posts)
        .where(and(eq(posts.userId, user.id), eq(posts.status, "published"))),
      db
        .select()
        .from(follows)
        .where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, user.id))),
    ]);

    return {
      id: user.id,
      handle: user.handle,
      name: user.name,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      verified: user.verified,
      voiceType: user.voiceType,
      country: user.country,
      openToLabel: user.openToLabel,
      isMe: user.id === viewerId,
      isFollowing: !!isFollowing,
      followerCount: followerCount.n,
      followingCount: followingCount.n,
      likesTotal: likesTotal.n,
    };
  });

export const listUserPosts = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { handle: string })
  .handler(async ({ data }) => {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, data.handle));
    if (!user) throw new Error("userNotFound");
    return db
      .select()
      .from(posts)
      .where(and(eq(posts.userId, user.id), eq(posts.status, "published")))
      .orderBy(desc(posts.createdAt));
  });

export const updateProfile = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) =>
      input as {
        name: string;
        bio: string;
        avatarUrl?: string;
        voiceType: string;
        country: string;
        openToLabel: boolean;
      },
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [updated] = await db
      .update(users)
      .set({
        name: data.name.trim() || "Unnamed",
        bio: data.bio,
        ...(data.avatarUrl ? { avatarUrl: data.avatarUrl } : {}),
        voiceType: data.voiceType,
        country: data.country,
        openToLabel: data.openToLabel,
      })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  });
