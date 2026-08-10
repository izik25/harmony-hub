import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, messages, users } from "@/db/schema";
import { requireUserId } from "./auth";

function sortPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export const getOrCreateConversation = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { otherUserId: string; initialMessage?: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    if (userId === data.otherUserId) throw new Error("cantMessageSelf");
    const [userA, userB] = sortPair(userId, data.otherUserId);

    let [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)));
    if (!conversation) {
      [conversation] = await db.insert(conversations).values({ userA, userB }).returning();
    }

    if (data.initialMessage?.trim()) {
      await db.insert(messages).values({
        conversationId: conversation.id,
        senderId: userId,
        body: data.initialMessage.trim(),
      });
      await db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, conversation.id));
    }

    return conversation;
  });

export const listConversations = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  const rows = await db
    .select()
    .from(conversations)
    .where(or(eq(conversations.userA, userId), eq(conversations.userB, userId)))
    .orderBy(desc(conversations.lastMessageAt));

  const result = [];
  for (const c of rows) {
    const otherId = c.userA === userId ? c.userB : c.userA;
    const [other] = await db.select().from(users).where(eq(users.id, otherId));
    const [lastMessage] = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, c.id))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const unread = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, c.id),
          ne(messages.senderId, userId),
          isNull(messages.readAt),
        ),
      );
    result.push({
      id: c.id,
      other: { id: other.id, name: other.name, handle: other.handle, avatarUrl: other.avatarUrl },
      lastMessage: lastMessage?.body ?? null,
      lastMessageAt: c.lastMessageAt,
      unreadCount: unread.length,
    });
  }
  return result;
});

export const listMessages = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { conversationId: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, data.conversationId));
    if (!conversation || (conversation.userA !== userId && conversation.userB !== userId)) {
      throw new Error("conversationNotFound");
    }
    await db
      .update(messages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(messages.conversationId, data.conversationId),
          ne(messages.senderId, userId),
          isNull(messages.readAt),
        ),
      );

    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, data.conversationId))
      .orderBy(messages.createdAt);
  });

export const sendMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { conversationId: string; body: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const body = data.body.trim();
    if (!body) throw new Error("messageEmpty");
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, data.conversationId));
    if (!conversation || (conversation.userA !== userId && conversation.userB !== userId)) {
      throw new Error("conversationNotFound");
    }
    const [message] = await db
      .insert(messages)
      .values({ conversationId: data.conversationId, senderId: userId, body })
      .returning();
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, data.conversationId));
    return message;
  });

export const unreadMessageCount = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        or(eq(conversations.userA, userId), eq(conversations.userB, userId)),
        ne(messages.senderId, userId),
        isNull(messages.readAt),
      ),
    );
  return rows.length;
});
