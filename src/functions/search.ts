import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, posts } from "@/db/schema";

export const searchAll = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { query: string })
  .handler(async ({ data }) => {
    const q = data.query.trim();
    if (!q) return { users: [], posts: [] };

    const [matchedUsers, matchedPosts] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          handle: users.handle,
          avatarUrl: users.avatarUrl,
          verified: users.verified,
        })
        .from(users)
        .where(or(ilike(users.name, `%${q}%`), ilike(users.handle, `%${q}%`)))
        .limit(20),
      db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.status, "published"),
            eq(posts.visibility, "public"),
            or(
              ilike(posts.title, `%${q}%`),
              ilike(posts.songTitle, `%${q}%`),
              sql`${posts.tags}::text ilike ${"%" + q + "%"}`,
            ),
          ),
        )
        .orderBy(desc(posts.likesCount))
        .limit(30),
    ]);

    return { users: matchedUsers, posts: matchedPosts };
  });

export const trendingTags = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await db.execute<{ tag: string; n: number }>(
    sql`select tag, count(*)::int as n from ${posts}, unnest(${posts.tags}) as tag
        where ${posts.status} = 'published' group by tag order by n desc limit 8`,
  );
  return rows.rows.map((r) => r.tag);
});

export const listPostsByType = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { type?: "original" | "djset" | "cover" })
  .handler(async ({ data }) => {
    const filters = [eq(posts.status, "published"), eq(posts.visibility, "public")];
    if (data.type) filters.push(eq(posts.type, data.type));
    return db
      .select()
      .from(posts)
      .where(and(...filters))
      .orderBy(desc(posts.likesCount))
      .limit(40);
  });
