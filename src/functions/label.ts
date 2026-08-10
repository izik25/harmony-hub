import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db/client";
import { users, auditions, auditionApplications, savedAuditions } from "@/db/schema";
import { requireUserId } from "./auth";
import { insertNotification } from "./notifications";

export const listTalent = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { query?: string })
  .handler(async ({ data }) => {
    const q = data.query?.trim();
    const filters = [eq(users.openToLabel, true)];
    if (q) {
      filters.push(
        or(
          ilike(users.name, `%${q}%`),
          ilike(users.handle, `%${q}%`),
          ilike(users.voiceType, `%${q}%`),
          ilike(users.country, `%${q}%`),
        )!,
      );
    }
    return db
      .select({
        id: users.id,
        name: users.name,
        handle: users.handle,
        avatarUrl: users.avatarUrl,
        verified: users.verified,
        voiceType: users.voiceType,
        country: users.country,
      })
      .from(users)
      .where(and(...filters))
      .orderBy(desc(users.verified));
  });

export const listAuditions = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  const rows = await db
    .select({
      id: auditions.id,
      title: auditions.title,
      description: auditions.description,
      createdAt: auditions.createdAt,
      label: { id: users.id, name: users.name, handle: users.handle },
    })
    .from(auditions)
    .innerJoin(users, eq(users.id, auditions.labelUserId))
    .orderBy(desc(auditions.createdAt));

  const [applied, saved] = await Promise.all([
    db
      .select({ auditionId: auditionApplications.auditionId })
      .from(auditionApplications)
      .where(eq(auditionApplications.userId, userId)),
    db
      .select({ auditionId: savedAuditions.auditionId })
      .from(savedAuditions)
      .where(eq(savedAuditions.userId, userId)),
  ]);
  const appliedSet = new Set(applied.map((a) => a.auditionId));
  const savedSet = new Set(saved.map((s) => s.auditionId));

  return rows.map((r) => ({ ...r, applied: appliedSet.has(r.id), saved: savedSet.has(r.id) }));
});

export const postAudition = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { title: string; description: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    if (!data.title.trim()) throw new Error("auditionTitleRequired");
    await db.insert(auditions).values({
      labelUserId: userId,
      title: data.title.trim(),
      description: data.description.trim(),
    });
    return { ok: true };
  });

export const applyToAudition = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { auditionId: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [existing] = await db
      .select()
      .from(auditionApplications)
      .where(
        and(
          eq(auditionApplications.auditionId, data.auditionId),
          eq(auditionApplications.userId, userId),
        ),
      );
    if (existing) throw new Error("alreadyApplied");

    const [audition] = await db.select().from(auditions).where(eq(auditions.id, data.auditionId));
    if (!audition) throw new Error("auditionNotFound");

    await db.insert(auditionApplications).values({ auditionId: data.auditionId, userId });
    await insertNotification({
      userId: audition.labelUserId,
      actorId: userId,
      type: "audition_application",
    });
    return { ok: true };
  });

export const toggleSaveAudition = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { auditionId: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [existing] = await db
      .select()
      .from(savedAuditions)
      .where(
        and(eq(savedAuditions.auditionId, data.auditionId), eq(savedAuditions.userId, userId)),
      );
    if (existing) {
      await db.delete(savedAuditions).where(eq(savedAuditions.id, existing.id));
      return { saved: false };
    }
    await db.insert(savedAuditions).values({ auditionId: data.auditionId, userId });
    return { saved: true };
  });
