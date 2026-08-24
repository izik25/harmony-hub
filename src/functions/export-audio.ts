import { createServerFn } from "@tanstack/react-start";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, walletTransactions } from "@/db/schema";
import { requireUserId } from "./auth";

export const EXPORT_PRICE_COINS = 25;

// Free for Pro subscribers, otherwise charges EXPORT_PRICE_COINS from the wallet — call this
// right before handing the user their studio-quality download (publishEverywhere modal).
export const purchaseExport = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  const [user] = await db
    .select({ coinsBalance: users.coinsBalance, isPro: users.isPro })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new Error("unauthorized");
  if (user.isPro) return { charged: 0 };
  if (user.coinsBalance < EXPORT_PRICE_COINS) throw new Error("notEnoughCoins");

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ coinsBalance: sql`${users.coinsBalance} - ${EXPORT_PRICE_COINS}` })
      .where(eq(users.id, userId));
    await tx.insert(walletTransactions).values({
      userId,
      kind: "export_purchase",
      coins: -EXPORT_PRICE_COINS,
      description: "",
    });
  });
  return { charged: EXPORT_PRICE_COINS };
});
