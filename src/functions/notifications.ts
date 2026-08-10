import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, users } from "@/db/schema";
import { requireUserId } from "./auth";

export const insertNotification = createServerOnlyFn(
  async (params: {
    userId: string;
    actorId: string;
    type: string;
    postId?: string;
    extra?: Record<string, string | number | boolean>;
  }) => {
    if (params.userId === params.actorId) return; // don't notify yourself
    await db.insert(notifications).values({
      userId: params.userId,
      actorId: params.actorId,
      type: params.type,
      postId: params.postId,
      extra: params.extra ?? {},
    });
  },
);

export const listNotifications = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      postId: notifications.postId,
      extra: notifications.extra,
      read: notifications.read,
      createdAt: notifications.createdAt,
      actor: { id: users.id, name: users.name, handle: users.handle, avatarUrl: users.avatarUrl },
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.actorId))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  return rows;
});

export const unreadNotificationCount = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return rows.length;
});

export const markAllNotificationsRead = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));
  return { ok: true };
});
