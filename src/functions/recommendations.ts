import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { and, count, desc, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { posts, users, follows, karaokeTracks, postViews, userAffinities } from "@/db/schema";
import {
  AFFINITY_HALF_LIFE_SECONDS,
  AFFINITY_MAX,
  AFFINITY_MIN,
  decayedScore,
  postFeatures,
  rankPosts,
  viewSignal,
  type FeaturePost,
  type RankCandidate,
} from "@/lib/feed-ranking";
import { requireUserId } from "./auth";

// Server plumbing for the "For You" feed: storing interest signals into user_affinities and
// ranking candidates with lib/feed-ranking.ts. The scoring model itself lives there.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadFeaturePost(postId: string): Promise<FeaturePost | null> {
  const [row] = await db
    .select({ post: posts, trackArtist: karaokeTracks.artist })
    .from(posts)
    .leftJoin(karaokeTracks, eq(karaokeTracks.id, posts.karaokeTrackId))
    .where(eq(posts.id, postId));
  if (!row) return null;
  return toFeaturePost(row.post, row.trackArtist);
}

function toFeaturePost(p: typeof posts.$inferSelect, trackArtist: string | null): FeaturePost {
  return {
    userId: p.userId,
    type: p.type,
    category: p.category,
    tags: p.tags,
    songTitle: p.songTitle,
    karaokeTrackId: p.karaokeTrackId,
    trackArtist,
    hasVideo: !!p.videoUrl,
  };
}

/** Adds `delta` (already per-feature weighted) to each feature's decayed score, in one upsert. */
async function bumpFeatures(userId: string, deltas: Array<[string, number]>) {
  const rows = deltas
    .filter(([, d]) => Number.isFinite(d) && d !== 0)
    .map(([feature, d]) => ({
      userId,
      feature,
      score: Math.min(AFFINITY_MAX, Math.max(AFFINITY_MIN, d)),
    }));
  if (rows.length === 0) return;
  await db
    .insert(userAffinities)
    .values(rows)
    .onConflictDoUpdate({
      target: [userAffinities.userId, userAffinities.feature],
      set: {
        // Decay the stored score up to now, then add the new signal — same formula as
        // lib/feed-ranking.ts decayedScore, done in SQL so concurrent signals don't race.
        score: sql`least(${AFFINITY_MAX}, greatest(${AFFINITY_MIN}, ${userAffinities.score} * power(0.5, extract(epoch from (now() - ${userAffinities.updatedAt})) / ${AFFINITY_HALF_LIFE_SECONDS}) + excluded.score))`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Feeds one explicit action (like/comment/share/gift) on a post into the viewer's interest
 * profile. Never throws — a recommendations hiccup must not fail the like/comment itself.
 */
export const recordPostSignal = createServerOnlyFn(
  async (userId: string, postId: string, weight: number) => {
    try {
      const post = await loadFeaturePost(postId);
      if (!post || post.userId === userId) return;
      await bumpFeatures(
        userId,
        postFeatures(post).map(([f, w]) => [f, w * weight]),
      );
    } catch (err) {
      console.error("recordPostSignal failed", err);
    }
  },
);

/** Follow/unfollow: only the author feature — it says "this person", not "these tags". */
export const recordAuthorSignal = createServerOnlyFn(
  async (userId: string, authorId: string, weight: number) => {
    try {
      if (userId === authorId) return;
      await bumpFeatures(userId, [[`author:${authorId}`, weight]]);
    } catch (err) {
      console.error("recordAuthorSignal failed", err);
    }
  },
);

function clampInt(v: unknown, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.round(Math.min(max, Math.max(min, n)));
}

/** One feed impression, sent by the client when a post stops being the active one. */
export const recordView = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const i = (input ?? {}) as Record<string, unknown>;
    return {
      postId: String(i.postId ?? ""),
      watchedMs: clampInt(i.watchedMs, 0, 15 * 60_000),
      dwellMs: clampInt(i.dwellMs, 0, 15 * 60_000),
      durationMs: clampInt(i.durationMs, 0, 60 * 60_000),
    };
  })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    if (!UUID_RE.test(data.postId)) return { ok: false };
    const outcome = viewSignal(data);
    if (!outcome) return { ok: true };

    const [row] = await db
      .select({ post: posts, trackArtist: karaokeTracks.artist })
      .from(posts)
      .leftJoin(karaokeTracks, eq(karaokeTracks.id, posts.karaokeTrackId))
      .where(eq(posts.id, data.postId));
    if (!row || row.post.status !== "published") return { ok: false };
    // Your own posts neither count as views nor teach the profile anything.
    if (row.post.userId === userId) return { ok: true };

    const ratio = Math.min(outcome.ratio, 10);
    await db.transaction(async (tx) => {
      await tx
        .insert(postViews)
        .values({
          userId,
          postId: data.postId,
          viewCount: 1,
          totalWatchMs: data.watchedMs,
          lastWatchRatio: ratio,
          skipped: outcome.skipped,
        })
        .onConflictDoUpdate({
          target: [postViews.userId, postViews.postId],
          set: {
            viewCount: sql`${postViews.viewCount} + 1`,
            totalWatchMs: sql`least(${postViews.totalWatchMs} + ${data.watchedMs}, 2000000000)`,
            lastWatchRatio: ratio,
            skipped: outcome.skipped,
            lastViewedAt: sql`now()`,
          },
        });
      await tx
        .update(posts)
        .set({
          viewsCount: sql`${posts.viewsCount} + 1`,
          watchRatioSum: sql`${posts.watchRatioSum} + ${Math.min(ratio, 1)}`,
        })
        .where(eq(posts.id, data.postId));
    });

    try {
      const feature = toFeaturePost(row.post, row.trackArtist);
      await bumpFeatures(
        userId,
        postFeatures(feature).map(([f, w]) => [f, w * outcome.weight]),
      );
    } catch (err) {
      console.error("recordView affinity update failed", err);
    }
    return { ok: true };
  });

const NEWEST_POOL = 300;
const POPULAR_POOL = 150;
const MAX_EXCLUDE = 400;

/**
 * The ranked feed page for a viewer (or for a logged-out visitor when viewerId is null — pure
 * quality + freshness). `excludeIds` are posts the client already has loaded, so each page is
 * new content ranked against the profile *as it is now*: the feed adapts while you scroll.
 */
export const rankFeed = createServerOnlyFn(
  async (viewerId: string | null, excludeIds: string[], limit: number): Promise<string[]> => {
    const exclude = excludeIds.filter((id) => UUID_RE.test(id)).slice(-MAX_EXCLUDE);
    const conditions: SQL[] = [eq(posts.status, "published"), eq(posts.visibility, "public")];
    if (exclude.length) conditions.push(notInArray(posts.id, exclude));
    const where = and(...conditions);

    const selectCandidates = () =>
      db
        .select({ post: posts, authorCountry: users.country, trackArtist: karaokeTracks.artist })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.userId))
        .leftJoin(karaokeTracks, eq(karaokeTracks.id, posts.karaokeTrackId))
        .where(where);

    // Two candidate sources: what's new, and what's proven — so older hits stay reachable.
    const [newest, popular] = await Promise.all([
      selectCandidates().orderBy(desc(posts.createdAt)).limit(NEWEST_POOL),
      selectCandidates()
        .orderBy(
          desc(
            sql`${posts.likesCount} + 2 * ${posts.commentsCount} + 3 * ${posts.sharesCount} + 3 * ${posts.giftsCount}`,
          ),
        )
        .limit(POPULAR_POOL),
    ]);

    const byId = new Map<string, RankCandidate>();
    for (const r of [...newest, ...popular]) {
      if (byId.has(r.post.id)) continue;
      byId.set(r.post.id, {
        ...toFeaturePost(r.post, r.trackArtist),
        id: r.post.id,
        createdAt: r.post.createdAt,
        viewsCount: r.post.viewsCount,
        watchRatioSum: r.post.watchRatioSum,
        likesCount: r.post.likesCount,
        commentsCount: r.post.commentsCount,
        sharesCount: r.post.sharesCount,
        giftsCount: r.post.giftsCount,
        authorCountry: r.authorCountry,
      });
    }
    const candidates = [...byId.values()];
    if (candidates.length === 0) return [];

    const now = new Date();
    const affinity = new Map<string, number>();
    const seen = new Map<string, { lastViewedAt: Date; skipped: boolean }>();
    const following = new Set<string>();
    let watchedCount = 0;
    let viewerCountry = "";

    if (viewerId) {
      const candidateIds = candidates.map((c) => c.id);
      const authorIds = [...new Set(candidates.map((c) => c.userId))];
      const features = [...new Set(candidates.flatMap((c) => postFeatures(c).map(([f]) => f)))];

      const [affRows, seenRows, followRows, [watched], [viewer]] = await Promise.all([
        db
          .select({
            feature: userAffinities.feature,
            score: userAffinities.score,
            updatedAt: userAffinities.updatedAt,
          })
          .from(userAffinities)
          .where(
            and(eq(userAffinities.userId, viewerId), inArray(userAffinities.feature, features)),
          ),
        db
          .select({
            postId: postViews.postId,
            lastViewedAt: postViews.lastViewedAt,
            skipped: postViews.skipped,
          })
          .from(postViews)
          .where(and(eq(postViews.userId, viewerId), inArray(postViews.postId, candidateIds))),
        db
          .select({ followeeId: follows.followeeId })
          .from(follows)
          .where(and(eq(follows.followerId, viewerId), inArray(follows.followeeId, authorIds))),
        db.select({ n: count() }).from(postViews).where(eq(postViews.userId, viewerId)),
        db.select({ country: users.country }).from(users).where(eq(users.id, viewerId)),
      ]);

      for (const r of affRows) affinity.set(r.feature, decayedScore(r.score, r.updatedAt, now));
      for (const r of seenRows)
        seen.set(r.postId, { lastViewedAt: r.lastViewedAt, skipped: r.skipped });
      for (const r of followRows) following.add(r.followeeId);
      watchedCount = watched?.n ?? 0;
      viewerCountry = viewer?.country ?? "";
    }

    return rankPosts(
      candidates,
      { viewerId, viewerCountry, affinity, watchedCount, seen, following, now },
      limit,
    ).map((c) => c.id);
  },
);
