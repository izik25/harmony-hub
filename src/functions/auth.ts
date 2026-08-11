import { randomUUID } from "node:crypto";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, sessions } from "@/db/schema";
import { toSafeError } from "./safe-error";

const SESSION_COOKIE = "sona_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type SessionUser = {
  id: string;
  handle: string;
  name: string;
  email: string;
  avatarUrl: string;
  bio: string;
  verified: boolean;
  voiceType: string;
  country: string;
  openToLabel: boolean;
  coinsBalance: number;
};

function toSessionUser(u: typeof users.$inferSelect): SessionUser {
  return {
    id: u.id,
    handle: u.handle,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    verified: u.verified,
    voiceType: u.voiceType,
    country: u.country,
    openToLabel: u.openToLabel,
    coinsBalance: u.coinsBalance,
  };
}

/** Server-only helper — call only from inside a createServerFn handler or route beforeLoad. */
export const getSessionUser = createServerOnlyFn(async (): Promise<SessionUser | null> => {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  try {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, token));
    if (!session || session.expiresAt.getTime() < Date.now()) return null;
    const [user] = await db.select().from(users).where(eq(users.id, session.userId));
    return user ? toSessionUser(user) : null;
  } catch (error) {
    throw toSafeError(error);
  }
});

/** Server-only helper — throws if there's no valid session. */
export const requireUserId = createServerOnlyFn(async (): Promise<string> => {
  const user = await getSessionUser();
  if (!user) throw new Error("unauthorized");
  return user.id;
});

async function createSession(userId: string) {
  const token = randomUUID() + randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await db.insert(sessions).values({ id: token, userId, expiresAt });
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  return await getSessionUser();
});

export const signup = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) => input as { handle: string; name: string; email: string; password: string },
  )
  .handler(async ({ data }) => {
    const handle = data.handle
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
    const name = data.name.trim();
    const email = data.email.trim().toLowerCase();

    if (handle.length < 3) throw new Error("handleTooShort");
    if (!name) throw new Error("nameRequired");
    if (!email.includes("@")) throw new Error("invalidEmail");
    if (data.password.length < 6) throw new Error("passwordTooShort");

    try {
      const [handleTaken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.handle, handle));
      if (handleTaken) throw new Error("handleTaken");
      const [emailTaken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (emailTaken) throw new Error("emailTaken");

      const passwordHash = await bcrypt.hash(data.password, 10);
      const [user] = await db
        .insert(users)
        .values({
          handle,
          name,
          email,
          passwordHash,
          avatarUrl: `https://api.dicebear.com/9.x/glass/svg?seed=${handle}`,
        })
        .returning();

      await createSession(user.id);
      return toSessionUser(user);
    } catch (error) {
      throw toSafeError(error);
    }
  });

export const login = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { email: string; password: string })
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    try {
      const [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user) throw new Error("invalidCredentials");
      const ok = await bcrypt.compare(data.password, user.passwordHash);
      if (!ok) throw new Error("invalidCredentials");
      await createSession(user.id);
      return toSessionUser(user);
    } catch (error) {
      throw toSafeError(error);
    }
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const token = getCookie(SESSION_COOKIE);
  if (token) await db.delete(sessions).where(eq(sessions.id, token));
  deleteCookie(SESSION_COOKIE, { path: "/" });
  return { ok: true };
});
