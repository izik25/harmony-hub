import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import {
  users,
  posts,
  comments,
  likes,
  follows,
  giftEvents,
  walletTransactions,
  competitions,
  competitionEntries,
  competitionVotes,
  messages,
  conversations,
  liveRooms,
  karaokeTracks,
  auditions,
  promotions,
} from "@/db/schema";
import { getSessionUser, type SessionUser } from "./auth";

/** Server-only helper — throws unless the current session belongs to an admin. */
export const requireAdmin = createServerOnlyFn(async (): Promise<SessionUser> => {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") throw new Error("unauthorized");
  return user;
});

async function dailyCounts(table: PgTable, dateCol: AnyPgColumn, days: number) {
  const { rows } = await db.execute<{ day: string; n: number }>(sql`
    select to_char(date_trunc('day', ${dateCol}), 'YYYY-MM-DD') as day, count(*)::int as n
    from ${table}
    where ${dateCol} >= now() - make_interval(days => ${days})
    group by 1
    order by 1
  `);
  return rows;
}

/** Fills in zero-count days so charts don't have gaps where nothing happened. */
function fillDays(rows: { day: string; n: number }[], days: number) {
  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  const out: { day: string; n: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, n: byDay.get(key) ?? 0 });
  }
  return out;
}

const TREND_DAYS = 30;

export const getAdminOverview = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();

  const [
    [usersCount],
    [postsCount],
    [commentsCount],
    [likesCount],
    [followsCount],
    [giftStats],
    [walletCoinsInCirculation],
    [competitionsCount],
    [entriesCount],
    [votesCount],
    [messagesCount],
    [conversationsCount],
    [liveActiveCount],
    [liveTotalCount],
    [karaokeCount],
    [auditionsCount],
    promotionCountRows,
    newUsersSeries,
    newPostsSeries,
    promotionsSeries,
  ] = await Promise.all([
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(posts),
    db.select({ n: count() }).from(comments),
    db.select({ n: count() }).from(likes),
    db.select({ n: count() }).from(follows),
    db
      .select({
        n: count(),
        coins: sql<number>`coalesce(sum(${giftEvents.coins}), 0)`.mapWith(Number),
      })
      .from(giftEvents),
    db
      .select({ n: sql<number>`coalesce(sum(${users.coinsBalance}), 0)`.mapWith(Number) })
      .from(users),
    db.select({ n: count() }).from(competitions),
    db.select({ n: count() }).from(competitionEntries),
    db.select({ n: count() }).from(competitionVotes),
    db.select({ n: count() }).from(messages),
    db.select({ n: count() }).from(conversations),
    db.select({ n: count() }).from(liveRooms).where(eq(liveRooms.status, "live")),
    db.select({ n: count() }).from(liveRooms),
    db.select({ n: count() }).from(karaokeTracks),
    db.select({ n: count() }).from(auditions),
    db
      .select({ status: promotions.status, n: count() })
      .from(promotions)
      .groupBy(promotions.status),
    dailyCounts(users, users.createdAt, TREND_DAYS),
    dailyCounts(posts, posts.createdAt, TREND_DAYS),
    dailyCounts(promotions, promotions.createdAt, TREND_DAYS),
  ]);

  const promoByStatus = { pending: 0, approved: 0, rejected: 0 };
  for (const row of promotionCountRows) {
    if (row.status in promoByStatus) {
      promoByStatus[row.status as keyof typeof promoByStatus] = row.n;
    }
  }

  return {
    totals: {
      users: usersCount.n,
      posts: postsCount.n,
      comments: commentsCount.n,
      likes: likesCount.n,
      follows: followsCount.n,
      giftsSent: giftStats.n,
      coinsGifted: giftStats.coins,
      coinsInCirculation: walletCoinsInCirculation.n,
      competitions: competitionsCount.n,
      competitionEntries: entriesCount.n,
      competitionVotes: votesCount.n,
      messages: messagesCount.n,
      conversations: conversationsCount.n,
      liveActive: liveActiveCount.n,
      liveTotal: liveTotalCount.n,
      karaokeTracks: karaokeCount.n,
      auditions: auditionsCount.n,
      promotionsPending: promoByStatus.pending,
      promotionsApproved: promoByStatus.approved,
      promotionsRejected: promoByStatus.rejected,
    },
    trends: {
      newUsers: fillDays(newUsersSeries, TREND_DAYS),
      newPosts: fillDays(newPostsSeries, TREND_DAYS),
      promotionsSubmitted: fillDays(promotionsSeries, TREND_DAYS),
    },
  };
});

export const listAdminUsers = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { query?: string; limit?: number })
  .handler(async ({ data }) => {
    await requireAdmin();
    const q = (data.query ?? "").trim();
    const limit = Math.min(Math.max(data.limit ?? 50, 1), 200);
    const filter: SQL | undefined = q
      ? or(ilike(users.name, `%${q}%`), ilike(users.handle, `%${q}%`), ilike(users.email, `%${q}%`))
      : undefined;

    return db
      .select({
        id: users.id,
        handle: users.handle,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: users.role,
        isBanned: users.isBanned,
        coinsBalance: users.coinsBalance,
        isPro: users.isPro,
        verified: users.verified,
        accountType: users.accountType,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(filter)
      .orderBy(desc(users.createdAt))
      .limit(limit);
  });

export const setUserRole = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { userId: string; role: "user" | "admin" })
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (data.userId === admin.id && data.role !== "admin") throw new Error("cantDemoteSelf");
    await db.update(users).set({ role: data.role }).where(eq(users.id, data.userId));
    return { ok: true };
  });

export const setUserBanned = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { userId: string; banned: boolean })
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (data.userId === admin.id) throw new Error("cantBanSelf");
    await db.update(users).set({ isBanned: data.banned }).where(eq(users.id, data.userId));
    return { ok: true };
  });

export const listPromotions = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { status?: "pending" | "approved" | "rejected" })
  .handler(async ({ data }) => {
    await requireAdmin();
    const filter = data.status ? eq(promotions.status, data.status) : undefined;

    return db
      .select({
        id: promotions.id,
        kind: promotions.kind,
        userId: promotions.userId,
        postId: promotions.postId,
        title: promotions.title,
        description: promotions.description,
        imageUrl: promotions.imageUrl,
        targetUrl: promotions.targetUrl,
        advertiserName: promotions.advertiserName,
        budgetCoins: promotions.budgetCoins,
        durationDays: promotions.durationDays,
        status: promotions.status,
        rejectionReason: promotions.rejectionReason,
        startAt: promotions.startAt,
        endAt: promotions.endAt,
        impressions: promotions.impressions,
        clicks: promotions.clicks,
        createdAt: promotions.createdAt,
        requesterHandle: users.handle,
        requesterName: users.name,
      })
      .from(promotions)
      .leftJoin(users, eq(users.id, promotions.userId))
      .where(filter)
      .orderBy(desc(promotions.createdAt))
      .limit(300);
  });

export const reviewPromotion = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) => input as { id: string; decision: "approved" | "rejected"; reason?: string },
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const [promo] = await db.select().from(promotions).where(eq(promotions.id, data.id));
    if (!promo) throw new Error("promotionNotFound");
    if (promo.status !== "pending") throw new Error("promotionAlreadyReviewed");

    const now = new Date();
    await db.transaction(async (tx) => {
      if (data.decision === "approved") {
        const endAt = new Date(now.getTime() + promo.durationDays * 24 * 60 * 60 * 1000);
        await tx
          .update(promotions)
          .set({ status: "approved", reviewedBy: admin.id, reviewedAt: now, startAt: now, endAt })
          .where(eq(promotions.id, data.id));
      } else {
        await tx
          .update(promotions)
          .set({
            status: "rejected",
            reviewedBy: admin.id,
            reviewedAt: now,
            rejectionReason: data.reason?.trim() || "",
          })
          .where(eq(promotions.id, data.id));

        // A boost pre-charges the requester's coins as escrow when submitted (see
        // promotions.ts's createBoost) — refund it on rejection. A sponsor_ad has no such
        // escrow (it's negotiated outside the app), so nothing to refund there.
        if (promo.kind === "boost" && promo.userId && promo.budgetCoins > 0) {
          await tx
            .update(users)
            .set({ coinsBalance: sql`${users.coinsBalance} + ${promo.budgetCoins}` })
            .where(eq(users.id, promo.userId));
          await tx.insert(walletTransactions).values({
            userId: promo.userId,
            kind: "boost_refund",
            coins: promo.budgetCoins,
            description: "",
          });
        }
      }
    });
    return { ok: true };
  });

export const createSponsorAd = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) =>
      input as {
        title: string;
        advertiserName?: string;
        description?: string;
        imageUrl?: string;
        targetUrl?: string;
        budgetCoins?: number;
        durationDays: number;
      },
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const title = data.title.trim();
    if (!title) throw new Error("promotionTitleRequired");
    const durationDays = Math.max(1, Math.floor(data.durationDays));
    const now = new Date();
    const endAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const [row] = await db
      .insert(promotions)
      .values({
        kind: "sponsor_ad",
        title,
        advertiserName: data.advertiserName?.trim() || "",
        description: data.description?.trim() || "",
        imageUrl: data.imageUrl?.trim() || "",
        targetUrl: data.targetUrl?.trim() || "",
        budgetCoins: Math.max(0, Math.floor(data.budgetCoins || 0)),
        durationDays,
        status: "approved",
        reviewedBy: admin.id,
        reviewedAt: now,
        startAt: now,
        endAt,
      })
      .returning();
    return row;
  });
