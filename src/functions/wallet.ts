import { createServerFn } from "@tanstack/react-start";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, walletTransactions, giftsCatalog, giftEvents, posts } from "@/db/schema";
import { requireUserId } from "./auth";
import { insertNotification } from "./notifications";

export const COIN_PACKAGES = [
  { id: "p1", coins: 1000 },
  { id: "p2", coins: 5000 },
  { id: "p3", coins: 12000 },
] as const;

export const listGiftCatalog = createServerFn({ method: "GET" }).handler(async () => {
  return db.select().from(giftsCatalog);
});

export const getWallet = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  const [user] = await db
    .select({ coinsBalance: users.coinsBalance })
    .from(users)
    .where(eq(users.id, userId));
  const history = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(50);
  return { balance: user?.coinsBalance ?? 0, history };
});

export const buyCoins = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { packageId: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const pkg = COIN_PACKAGES.find((p) => p.id === data.packageId);
    if (!pkg) throw new Error("unknownPackage");

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ coinsBalance: sql`${users.coinsBalance} + ${pkg.coins}` })
        .where(eq(users.id, userId));
      await tx
        .insert(walletTransactions)
        .values({ userId, kind: "topup", coins: pkg.coins, description: "" });
    });
    return { ok: true };
  });

export const withdraw = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { amount: number })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const amount = Math.floor(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalidAmount");

    const [user] = await db
      .select({ coinsBalance: users.coinsBalance })
      .from(users)
      .where(eq(users.id, userId));
    if (!user || user.coinsBalance < amount) throw new Error("insufficientBalance");

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ coinsBalance: sql`${users.coinsBalance} - ${amount}` })
        .where(eq(users.id, userId));
      await tx.insert(walletTransactions).values({
        userId,
        kind: "withdraw",
        coins: -amount,
        description: "",
      });
    });
    return { ok: true };
  });

export const sendGift = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { toUserId: string; giftId: string; postId?: string })
  .handler(async ({ data }) => {
    const fromUserId = await requireUserId();
    if (fromUserId === data.toUserId) throw new Error("cantGiftSelf");

    const [gift] = await db.select().from(giftsCatalog).where(eq(giftsCatalog.id, data.giftId));
    if (!gift) throw new Error("unknownGift");

    const [sender] = await db
      .select({ coinsBalance: users.coinsBalance })
      .from(users)
      .where(eq(users.id, fromUserId));
    if (!sender || sender.coinsBalance < gift.coins) throw new Error("notEnoughCoins");

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ coinsBalance: sql`${users.coinsBalance} - ${gift.coins}` })
        .where(eq(users.id, fromUserId));
      await tx
        .update(users)
        .set({ coinsBalance: sql`${users.coinsBalance} + ${gift.coins}` })
        .where(eq(users.id, data.toUserId));
      await tx.insert(walletTransactions).values({
        userId: fromUserId,
        kind: "gift_sent",
        coins: -gift.coins,
        description: gift.key,
      });
      await tx.insert(walletTransactions).values({
        userId: data.toUserId,
        kind: "gift_received",
        coins: gift.coins,
        description: gift.key,
      });
      await tx.insert(giftEvents).values({
        fromUserId,
        toUserId: data.toUserId,
        postId: data.postId,
        giftId: gift.id,
        coins: gift.coins,
      });
      if (data.postId) {
        await tx
          .update(posts)
          .set({ giftsCount: sql`${posts.giftsCount} + 1` })
          .where(eq(posts.id, data.postId));
      }
    });
    await insertNotification({
      userId: data.toUserId,
      actorId: fromUserId,
      type: "gift",
      postId: data.postId,
      extra: { giftKey: gift.key, giftEmoji: gift.emoji, coins: gift.coins },
    });
    return { ok: true };
  });
