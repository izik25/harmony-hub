import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { competitions, competitionEntries, competitionVotes, posts, users } from "@/db/schema";
import { requireUserId } from "./auth";
import { insertNotification } from "./notifications";

export const listUserCompetitionEntries = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { handle: string })
  .handler(async ({ data }) => {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, data.handle));
    if (!user) return [];
    return db
      .select({
        id: competitionEntries.id,
        votesCount: competitionEntries.votesCount,
        competitionTitle: competitions.title,
        competitionId: competitions.id,
      })
      .from(competitionEntries)
      .innerJoin(competitions, eq(competitions.id, competitionEntries.competitionId))
      .where(eq(competitionEntries.userId, user.id))
      .orderBy(desc(competitionEntries.createdAt));
  });

export const listCompetitions = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { status?: "active" | "upcoming" | "finished" })
  .handler(async ({ data }) => {
    const rows = await db
      .select({
        id: competitions.id,
        title: competitions.title,
        stage: competitions.stage,
        status: competitions.status,
        prize: competitions.prize,
        coverSeed: competitions.coverSeed,
        hue: competitions.hue,
        createdAt: competitions.createdAt,
        participants: sql<number>`count(${competitionEntries.id})`.mapWith(Number),
      })
      .from(competitions)
      .leftJoin(competitionEntries, eq(competitionEntries.competitionId, competitions.id))
      .where(data.status ? eq(competitions.status, data.status) : undefined)
      .groupBy(competitions.id)
      .orderBy(desc(competitions.createdAt));
    return rows;
  });

export const getCompetition = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { id: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [competition] = await db.select().from(competitions).where(eq(competitions.id, data.id));
    if (!competition) throw new Error("competitionNotFound");

    const entries = await db
      .select({
        id: competitionEntries.id,
        votesCount: competitionEntries.votesCount,
        post: posts,
        user: { id: users.id, name: users.name, handle: users.handle, avatarUrl: users.avatarUrl },
      })
      .from(competitionEntries)
      .innerJoin(posts, eq(posts.id, competitionEntries.postId))
      .innerJoin(users, eq(users.id, competitionEntries.userId))
      .where(eq(competitionEntries.competitionId, data.id))
      .orderBy(desc(competitionEntries.votesCount));

    const [myVote] = await db
      .select()
      .from(competitionVotes)
      .where(
        and(eq(competitionVotes.competitionId, data.id), eq(competitionVotes.voterId, userId)),
      );

    return { competition, entries, myVoteEntryId: myVote?.entryId ?? null };
  });

export const joinCompetition = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { competitionId: string; postId: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [post] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, data.postId), eq(posts.userId, userId)));
    if (!post || post.status !== "published") throw new Error("pickOwnPost");

    const [existing] = await db
      .select()
      .from(competitionEntries)
      .where(
        and(
          eq(competitionEntries.competitionId, data.competitionId),
          eq(competitionEntries.userId, userId),
        ),
      );
    if (existing) throw new Error("alreadyEnteredCompetition");

    await db
      .insert(competitionEntries)
      .values({ competitionId: data.competitionId, userId, postId: data.postId });
    return { ok: true };
  });

export const voteEntry = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { entryId: string })
  .handler(async ({ data }) => {
    const voterId = await requireUserId();
    const [entry] = await db
      .select()
      .from(competitionEntries)
      .where(eq(competitionEntries.id, data.entryId));
    if (!entry) throw new Error("entryNotFound");
    if (entry.userId === voterId) throw new Error("cantVoteOwnEntry");

    const [existing] = await db
      .select()
      .from(competitionVotes)
      .where(
        and(
          eq(competitionVotes.competitionId, entry.competitionId),
          eq(competitionVotes.voterId, voterId),
        ),
      );
    if (existing) throw new Error("alreadyVoted");

    await db.transaction(async (tx) => {
      await tx
        .insert(competitionVotes)
        .values({ competitionId: entry.competitionId, entryId: entry.id, voterId });
      await tx
        .update(competitionEntries)
        .set({ votesCount: sql`${competitionEntries.votesCount} + 1` })
        .where(eq(competitionEntries.id, entry.id));
    });
    await insertNotification({
      userId: entry.userId,
      actorId: voterId,
      type: "vote",
      postId: entry.postId,
    });
    return { ok: true };
  });
