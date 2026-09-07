import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { posts, users, likes, follows, comments } from "@/db/schema";
import { requireUserId } from "./auth";
import { insertNotification } from "./notifications";

export type FeedPostDTO = {
  id: string;
  type: string;
  title: string;
  song: string;
  hue: number;
  coverUrl: string;
  audioUrl: string;
  videoUrl: string;
  user: { id: string; name: string; handle: string; verified: boolean; avatar: string };
  likes: number;
  comments: number;
  shares: number;
  gifts: number;
  credits: { performer: string; writer: string; composer: string; producer: string };
  likedByMe: boolean;
  followingAuthor: boolean;
};

async function hydrateFeed(
  rows: Array<typeof posts.$inferSelect & { author: typeof users.$inferSelect }>,
  viewerId: string,
): Promise<FeedPostDTO[]> {
  if (rows.length === 0) return [];
  const postIds = rows.map((r) => r.id);
  const authorIds = [...new Set(rows.map((r) => r.author.id))];

  const [likedRows, followedRows] = await Promise.all([
    db
      .select({ postId: likes.postId })
      .from(likes)
      .where(and(eq(likes.userId, viewerId), inArray(likes.postId, postIds))),
    db
      .select({ followeeId: follows.followeeId })
      .from(follows)
      .where(and(eq(follows.followerId, viewerId), inArray(follows.followeeId, authorIds))),
  ]);
  const likedSet = new Set(likedRows.map((r) => r.postId));
  const followedSet = new Set(followedRows.map((r) => r.followeeId));

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    song: r.songTitle,
    hue: r.hue,
    coverUrl: r.coverUrl,
    audioUrl: r.audioUrl,
    videoUrl: r.videoUrl,
    user: {
      id: r.author.id,
      name: r.author.name,
      handle: r.author.handle,
      verified: r.author.verified,
      avatar: r.author.avatarUrl,
    },
    likes: r.likesCount,
    comments: r.commentsCount,
    shares: r.sharesCount,
    gifts: r.giftsCount,
    credits: r.credits,
    likedByMe: likedSet.has(r.id),
    followingAuthor: followedSet.has(r.author.id),
  }));
}

export const listFeed = createServerFn({ method: "GET" }).handler(
  async (): Promise<FeedPostDTO[]> => {
    const userId = await requireUserId();
    const rows = await db
      .select()
      .from(posts)
      .innerJoin(users, eq(users.id, posts.userId))
      .where(and(eq(posts.status, "published"), eq(posts.visibility, "public")))
      .orderBy(desc(posts.createdAt))
      .limit(50);
    return hydrateFeed(
      rows.map((r) => ({ ...r.posts, author: r.users })),
      userId,
    );
  },
);

export const toggleLike = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { postId: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [existing] = await db
      .select()
      .from(likes)
      .where(and(eq(likes.userId, userId), eq(likes.postId, data.postId)));

    if (existing) {
      await db.transaction(async (tx) => {
        await tx.delete(likes).where(eq(likes.id, existing.id));
        await tx
          .update(posts)
          .set({ likesCount: sql`${posts.likesCount} - 1` })
          .where(eq(posts.id, data.postId));
      });
      return { liked: false };
    }

    const [post] = await db.select().from(posts).where(eq(posts.id, data.postId));
    if (!post) throw new Error("postNotFound");

    await db.transaction(async (tx) => {
      await tx.insert(likes).values({ userId, postId: data.postId });
      await tx
        .update(posts)
        .set({ likesCount: sql`${posts.likesCount} + 1` })
        .where(eq(posts.id, data.postId));
    });
    await insertNotification({
      userId: post.userId,
      actorId: userId,
      type: "like",
      postId: post.id,
    });
    return { liked: true };
  });

export const toggleFollow = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { userId: string })
  .handler(async ({ data }) => {
    const followerId = await requireUserId();
    if (followerId === data.userId) throw new Error("cantFollowSelf");

    const [existing] = await db
      .select()
      .from(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, data.userId)));

    if (existing) {
      await db.delete(follows).where(eq(follows.id, existing.id));
      return { following: false };
    }

    await db.insert(follows).values({ followerId, followeeId: data.userId });
    await insertNotification({ userId: data.userId, actorId: followerId, type: "follow" });
    return { following: true };
  });

export const sharePost = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { postId: string })
  .handler(async ({ data }) => {
    await requireUserId();
    await db
      .update(posts)
      .set({ sharesCount: sql`${posts.sharesCount} + 1` })
      .where(eq(posts.id, data.postId));
    return { ok: true };
  });

export const listComments = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { postId: string })
  .handler(async ({ data }) => {
    await requireUserId();
    const rows = await db
      .select({
        id: comments.id,
        body: comments.body,
        createdAt: comments.createdAt,
        user: { id: users.id, name: users.name, handle: users.handle, avatar: users.avatarUrl },
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.postId, data.postId))
      .orderBy(desc(comments.createdAt));
    return rows;
  });

export const createDraft = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) =>
      input as {
        audioUrl: string;
        title?: string;
        type?: string;
        rawVocalUrl?: string;
        backingTrackUrl?: string;
        videoUrl?: string;
      },
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [draft] = await db
      .insert(posts)
      .values({
        userId,
        type: data.type ?? "original",
        title: data.title ?? "Untitled recording",
        audioUrl: data.audioUrl,
        rawVocalUrl: data.rawVocalUrl ?? "",
        backingTrackUrl: data.backingTrackUrl ?? "",
        videoUrl: data.videoUrl ?? "",
        hue: Math.floor(Math.random() * 360),
        credits: { performer: "", writer: "", composer: "", producer: "" },
        status: "draft",
      })
      .returning();
    return draft;
  });

export const getDraft = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { id: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [draft] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, data.id), eq(posts.userId, userId)));
    if (!draft) throw new Error("draftNotFound");
    return draft;
  });

export const updateDraftAudio = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) =>
      input as {
        id: string;
        audioUrl: string;
        rawVocalUrl?: string;
        // Distinguished from "not passed" (`undefined`, left untouched) so a caller can
        // explicitly clear either one — e.g. Studio's "replace video with cover image" sends
        // `videoUrl: ""` to drop the video and `coverUrl` to set the new image.
        videoUrl?: string;
        coverUrl?: string;
      },
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await db
      .update(posts)
      .set({
        audioUrl: data.audioUrl,
        ...(data.rawVocalUrl ? { rawVocalUrl: data.rawVocalUrl } : {}),
        ...(data.videoUrl !== undefined ? { videoUrl: data.videoUrl } : {}),
        ...(data.coverUrl !== undefined ? { coverUrl: data.coverUrl } : {}),
      })
      .where(and(eq(posts.id, data.id), eq(posts.userId, userId)));
    return { ok: true };
  });

export const publishPost = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) =>
      input as {
        draftId?: string;
        audioUrl?: string;
        videoUrl?: string;
        coverUrl?: string;
        type: string;
        title: string;
        songTitle?: string;
        category?: string;
        tags?: Array<string>;
        credits: { performer: string; writer: string; composer: string; producer: string };
        visibility: "public" | "private";
      },
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const common = {
      type: data.type,
      title: data.title,
      songTitle: data.songTitle ?? "",
      category: data.category ?? "",
      tags: data.tags ?? [],
      credits: data.credits,
      visibility: data.visibility,
      status: "published" as const,
      ...(data.coverUrl ? { coverUrl: data.coverUrl } : {}),
    };

    if (data.draftId) {
      const [draft] = await db
        .select()
        .from(posts)
        .where(and(eq(posts.id, data.draftId), eq(posts.userId, userId)));
      if (!draft) throw new Error("draftNotFound");
      const [updated] = await db
        .update(posts)
        .set({
          ...common,
          audioUrl: data.audioUrl ?? draft.audioUrl,
          videoUrl: data.videoUrl ?? draft.videoUrl,
        })
        .where(eq(posts.id, data.draftId))
        .returning();
      return updated;
    }

    if (!data.audioUrl && !data.videoUrl) throw new Error("noMediaToPublish");
    const [created] = await db
      .insert(posts)
      .values({
        userId,
        hue: Math.floor(Math.random() * 360),
        audioUrl: data.audioUrl ?? "",
        videoUrl: data.videoUrl ?? "",
        ...common,
      })
      .returning();
    return created;
  });

export const listMyPublishedPosts = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return db
    .select()
    .from(posts)
    .where(and(eq(posts.userId, userId), eq(posts.status, "published")))
    .orderBy(desc(posts.createdAt));
});

export const listMyDrafts = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return db
    .select()
    .from(posts)
    .where(and(eq(posts.userId, userId), eq(posts.status, "draft")))
    .orderBy(desc(posts.createdAt));
});

export const addComment = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { postId: string; body: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const body = data.body.trim();
    if (!body) throw new Error("commentEmpty");

    const [post] = await db.select().from(posts).where(eq(posts.id, data.postId));
    if (!post) throw new Error("postNotFound");

    await db.transaction(async (tx) => {
      await tx.insert(comments).values({ postId: data.postId, userId, body });
      await tx
        .update(posts)
        .set({ commentsCount: sql`${posts.commentsCount} + 1` })
        .where(eq(posts.id, data.postId));
    });
    await insertNotification({
      userId: post.userId,
      actorId: userId,
      type: "comment",
      postId: post.id,
    });
    return { ok: true };
  });

export const deleteComment = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { id: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [row] = await db
      .select({
        postId: comments.postId,
        authorId: comments.userId,
        postOwnerId: posts.userId,
      })
      .from(comments)
      .innerJoin(posts, eq(posts.id, comments.postId))
      .where(eq(comments.id, data.id));
    if (!row) throw new Error("commentNotFound");
    // Either the person who wrote it, or the owner of the post it's on (moderation) — same as
    // every other TikTok-style platform's comment permissions.
    if (row.authorId !== userId && row.postOwnerId !== userId) throw new Error("cantDeleteComment");

    await db.transaction(async (tx) => {
      await tx.delete(comments).where(eq(comments.id, data.id));
      await tx
        .update(posts)
        .set({ commentsCount: sql`greatest(${posts.commentsCount} - 1, 0)` })
        .where(eq(posts.id, row.postId));
    });
    return { ok: true };
  });

// Metadata-only edit for an already-published post — caption/category/tags/credits/visibility/
// cover, deliberately never audioUrl. Re-mastering the actual audio already has its own path
// (Studio, via a draftId), which re-encodes the take through the full DSP chain; routing a simple
// caption fix through that would silently reprocess audio nobody asked to touch.
export const updatePost = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) =>
      input as {
        id: string;
        title: string;
        songTitle?: string;
        category?: string;
        tags?: Array<string>;
        credits: { performer: string; writer: string; composer: string; producer: string };
        visibility: "public" | "private";
        coverUrl?: string;
      },
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [existing] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, data.id), eq(posts.userId, userId)));
    if (!existing) throw new Error("postNotFound");

    const [updated] = await db
      .update(posts)
      .set({
        title: data.title.trim() || "Untitled",
        songTitle: data.songTitle?.trim() ?? "",
        category: data.category ?? "",
        tags: data.tags ?? [],
        credits: data.credits,
        visibility: data.visibility,
        ...(data.coverUrl ? { coverUrl: data.coverUrl } : {}),
      })
      .where(eq(posts.id, data.id))
      .returning();
    return updated;
  });

export const deletePost = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { id: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const deleted = await db
      .delete(posts)
      .where(and(eq(posts.id, data.id), eq(posts.userId, userId)))
      .returning({ id: posts.id });
    if (deleted.length === 0) throw new Error("postNotFound");
    return { ok: true };
  });
