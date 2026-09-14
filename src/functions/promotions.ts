import { createServerFn } from "@tanstack/react-start";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, posts, promotions, walletTransactions } from "@/db/schema";
import { requireUserId } from "./auth";

export const BOOST_PACKAGES = [
  { id: "boost1", days: 1, coins: 200 },
  { id: "boost3", days: 3, coins: 500 },
  { id: "boost7", days: 7, coins: 1000 },
] as const;

/**
 * A post owner spends coins up front to submit a promotion request — coins are held in escrow
 * (deducted immediately) until an admin reviews it in /admin, and refunded automatically if
 * rejected (see reviewPromotion in functions/admin.ts).
 */
export const createBoost = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { postId: string; packageId: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const pkg = BOOST_PACKAGES.find((p) => p.id === data.packageId);
    if (!pkg) throw new Error("unknownPackage");

    const [post] = await db
      .select({ id: posts.id, userId: posts.userId, title: posts.title })
      .from(posts)
      .where(eq(posts.id, data.postId));
    if (!post || post.userId !== userId) throw new Error("postNotFound");

    const [pending] = await db
      .select({ id: promotions.id })
      .from(promotions)
      .where(
        and(
          eq(promotions.postId, data.postId),
          eq(promotions.kind, "boost"),
          eq(promotions.status, "pending"),
        ),
      );
    if (pending) throw new Error("boostAlreadyPending");

    const [user] = await db
      .select({ coinsBalance: users.coinsBalance })
      .from(users)
      .where(eq(users.id, userId));
    if (!user || user.coinsBalance < pkg.coins) throw new Error("notEnoughCoins");

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ coinsBalance: sql`${users.coinsBalance} - ${pkg.coins}` })
        .where(eq(users.id, userId));
      await tx.insert(walletTransactions).values({
        userId,
        kind: "boost_purchase",
        coins: -pkg.coins,
        description: "",
      });
      await tx.insert(promotions).values({
        kind: "boost",
        userId,
        postId: data.postId,
        title: post.title,
        budgetCoins: pkg.coins,
        durationDays: pkg.days,
        status: "pending",
      });
    });
    return { ok: true };
  });

export const listMyBoosts = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return db
    .select()
    .from(promotions)
    .where(and(eq(promotions.userId, userId), eq(promotions.kind, "boost")));
});
