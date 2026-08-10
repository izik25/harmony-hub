import { createServerFn } from "@tanstack/react-start";
import { desc, ilike, or } from "drizzle-orm";
import { db } from "@/db/client";
import { karaokeTracks } from "@/db/schema";
import { requireUserId } from "./auth";

export const listKaraokeTracks = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { query?: string })
  .handler(async ({ data }) => {
    await requireUserId();
    const q = data.query?.trim();
    return db
      .select()
      .from(karaokeTracks)
      .where(
        q
          ? or(ilike(karaokeTracks.title, `%${q}%`), ilike(karaokeTracks.artist, `%${q}%`))
          : undefined,
      )
      .orderBy(desc(karaokeTracks.createdAt));
  });
