import "./lib/error-capture";

import { randomUUID } from "node:crypto";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { and, eq } from "drizzle-orm";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { db } from "./db/client";
import { sessions, platformConnections, users } from "./db/schema";
import {
  socialPlatforms,
  isOAuthPlatformId,
  redirectUriFor,
  type OAuthPlatformId,
} from "./lib/social-platforms";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

const SESSION_COOKIE = "sona_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

// Mirrors functions/auth.ts's session check, but against a raw Request — this endpoint is
// handled outside TanStack Start's router (see handleBlobUploadRequest below), so none of the
// framework's request-context helpers (getCookie, createServerFn, etc.) are available here.
async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)sona_session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const [session] = await db.select().from(sessions).where(eq(sessions.id, token));
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return session.userId;
}

// Recordings/exports (uncompressed WAV) and video uploads regularly exceed the request-body
// limit Vercel enforces on serverless function invocations (historically ~4.5MB) — routing them
// through a createServerFn, whose entire request body is that limit, made Save/Publish fail with
// "FUNCTION_PAYLOAD_TOO_LARGE" for anything longer than roughly a minute of audio. This endpoint
// lets the browser upload directly to Vercel Blob instead: the client calls upload() from
// @vercel/blob/client, which POSTs here first (a tiny JSON request, no file bytes) to get a
// short-lived client token, then PUTs the actual file straight to Blob storage — our function
// never sees the file body at all. Plain fetch handler (not a createServerFn) because the SDK's
// upload() calls this URL directly with its own request/response shape.
async function handleBlobUploadRequest(request: Request): Promise<Response> {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["audio/*", "video/*", "image/*"],
        maximumSizeInBytes: 100 * 1024 * 1024,
        addRandomSuffix: true,
      }),
    });
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    // Most commonly: no BLOB_READ_WRITE_TOKEN configured (local dev without a Blob store) — the
    // client helper (lib/blob-upload.ts) falls back to the old server-function upload path for
    // exactly this response.
    const message = error instanceof Error ? error.message : "blob upload failed";
    return new Response(JSON.stringify({ error: message }), { status: 501 });
  }
}

// "Publish everywhere" OAuth connect/callback — same raw-fetch-handler approach as the blob
// upload endpoint above, and for the same reason: these need full control over redirects and
// Set-Cookie headers that createServerFn's RPC shape doesn't give us.
const OAUTH_STATE_COOKIE = "sona_oauth_state";

type OAuthStateCookie = { state: string; returnTo: string; platform: OAuthPlatformId };

function oauthStateCookieHeader(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_STATE_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readOAuthStateCookie(request: Request): OAuthStateCookie | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)sona_oauth_state=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1])) as OAuthStateCookie;
  } catch {
    return null;
  }
}

async function handleConnectStart(request: Request, platform: OAuthPlatformId): Promise<Response> {
  const userId = await getUserIdFromRequest(request);
  const url = new URL(request.url);
  if (!userId) return Response.redirect(new URL("/login", url.origin).toString(), 302);

  const social = socialPlatforms[platform];
  if (!social.configured()) {
    return new Response(`${platform} is not configured on this server yet`, { status: 501 });
  }

  const returnTo = url.searchParams.get("returnTo") || "/upload";
  const state = randomUUID();
  const redirectUri = redirectUriFor(url.origin, platform);
  const cookieValue = encodeURIComponent(JSON.stringify({ state, returnTo, platform }));

  return new Response(null, {
    status: 302,
    headers: {
      location: social.authorizeUrl(redirectUri, state),
      "set-cookie": oauthStateCookieHeader(cookieValue, 600),
    },
  });
}

async function handleConnectCallback(
  request: Request,
  platform: OAuthPlatformId,
): Promise<Response> {
  const url = new URL(request.url);
  const social = socialPlatforms[platform];
  const stateCookie = readOAuthStateCookie(request);
  const returnTo = stateCookie?.returnTo || "/upload";
  const clearCookie = oauthStateCookieHeader("", 0);

  const fail = (reason: string) => {
    const target = new URL(returnTo, url.origin);
    target.searchParams.set("platformError", `${platform}:${reason}`);
    return new Response(null, {
      status: 302,
      headers: { location: target.toString(), "set-cookie": clearCookie },
    });
  };

  const userId = await getUserIdFromRequest(request);
  if (!userId) return fail("notLoggedIn");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (
    !code ||
    !state ||
    !stateCookie ||
    state !== stateCookie.state ||
    stateCookie.platform !== platform
  ) {
    return fail("invalidState");
  }

  try {
    const redirectUri = redirectUriFor(url.origin, platform);
    const tokens = await social.exchangeCode(code, redirectUri);
    const [existing] = await db
      .select()
      .from(platformConnections)
      .where(
        and(eq(platformConnections.userId, userId), eq(platformConnections.platform, platform)),
      );

    if (existing) {
      await db
        .update(platformConnections)
        .set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          externalAccountId: tokens.externalAccountId,
          externalAccountName: tokens.externalAccountName,
          updatedAt: new Date(),
        })
        .where(eq(platformConnections.id, existing.id));
    } else {
      await db.insert(platformConnections).values({
        userId,
        platform,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        externalAccountId: tokens.externalAccountId,
        externalAccountName: tokens.externalAccountName,
      });
    }
  } catch (error) {
    console.error(error);
    return fail("exchangeFailed");
  }

  const target = new URL(returnTo, url.origin);
  target.searchParams.set("platformConnected", platform);
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), "set-cookie": clearCookie },
  });
}

async function handleConnectRequest(request: Request, pathname: string): Promise<Response | null> {
  const match = pathname.match(/^\/api\/connect\/([a-z_]+)\/(start|callback)$/);
  if (!match) return null;
  const [, platform, action] = match;
  if (!isOAuthPlatformId(platform)) return new Response("Unknown platform", { status: 404 });
  return action === "start"
    ? handleConnectStart(request, platform)
    : handleConnectCallback(request, platform);
}

// "Continue with Google" sign-in/signup — a second, separate OAuth round-trip from the
// publish-everywhere YouTube connect above. Same Google Cloud OAuth client (GOOGLE_CLIENT_ID/
// SECRET) works for both since Google clients accept multiple redirect URIs; this one just asks
// for "openid email profile" instead of the youtube.upload scope, and ends in a logged-in session
// instead of a platformConnections row. Register {origin}/api/auth/google/callback as an
// additional redirect URI in the same Google Cloud OAuth client.
const GOOGLE_AUTH_STATE_COOKIE = "sona_google_auth_state";

function googleAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function googleAuthStateCookieHeader(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GOOGLE_AUTH_STATE_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readGoogleAuthStateCookie(request: Request): { state: string; returnTo: string } | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)sona_google_auth_state=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1])) as { state: string; returnTo: string };
  } catch {
    return null;
  }
}

function sessionCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

async function createRawSession(userId: string): Promise<string> {
  const token = randomUUID() + randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await db.insert(sessions).values({ id: token, userId, expiresAt });
  return token;
}

async function uniqueHandleFromGoogleProfile(base: string): Promise<string> {
  const cleaned = base.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) || "user";
  let handle = cleaned;
  let suffix = 0;
  for (;;) {
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle));
    if (!taken) return handle;
    suffix += 1;
    handle = `${cleaned}${suffix}`;
  }
}

async function upsertGoogleUser(profile: {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}): Promise<string> {
  const [byGoogleId] = await db.select().from(users).where(eq(users.googleId, profile.sub));
  if (byGoogleId) return byGoogleId.id;

  const email = profile.email?.trim().toLowerCase();
  if (email) {
    const [byEmail] = await db.select().from(users).where(eq(users.email, email));
    if (byEmail) {
      await db.update(users).set({ googleId: profile.sub }).where(eq(users.id, byEmail.id));
      return byEmail.id;
    }
  }

  const handle = await uniqueHandleFromGoogleProfile(email?.split("@")[0] || profile.name || "user");
  const [user] = await db
    .insert(users)
    .values({
      handle,
      name: profile.name || handle,
      email,
      googleId: profile.sub,
      avatarUrl: profile.picture || `https://api.dicebear.com/9.x/glass/svg?seed=${handle}`,
    })
    .returning();
  return user.id;
}

async function handleGoogleAuthStart(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!googleAuthConfigured()) {
    return new Response("Google sign-in is not configured on this server yet", { status: 501 });
  }

  const returnTo = url.searchParams.get("returnTo") || "/";
  const state = randomUUID();
  const redirectUri = new URL("/api/auth/google/callback", url.origin).toString();
  const cookieValue = encodeURIComponent(JSON.stringify({ state, returnTo }));

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  return new Response(null, {
    status: 302,
    headers: {
      location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      "set-cookie": googleAuthStateCookieHeader(cookieValue, 600),
    },
  });
}

async function handleGoogleAuthCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const stateCookie = readGoogleAuthStateCookie(request);
  const clearCookie = googleAuthStateCookieHeader("", 0);

  const fail = (reason: string) => {
    const target = new URL("/login", url.origin);
    target.searchParams.set("authError", reason);
    return new Response(null, {
      status: 302,
      headers: { location: target.toString(), "set-cookie": clearCookie },
    });
  };

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !stateCookie || state !== stateCookie.state) return fail("invalidState");

  try {
    const redirectUri = new URL("/api/auth/google/callback", url.origin).toString();
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const tokens = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) throw new Error(await profileRes.text());
    const profile = (await profileRes.json()) as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    const userId = await upsertGoogleUser(profile);
    const token = await createRawSession(userId);

    const headers = new Headers();
    headers.set("location", new URL(stateCookie.returnTo, url.origin).toString());
    headers.append("set-cookie", clearCookie);
    headers.append("set-cookie", sessionCookieHeader(token));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error(error);
    return fail("exchangeFailed");
  }
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const pathname = new URL(request.url).pathname;
      if (request.method === "POST" && pathname === "/api/blob-upload") {
        return await handleBlobUploadRequest(request);
      }
      if (request.method === "GET") {
        const connectResponse = await handleConnectRequest(request, pathname);
        if (connectResponse) return connectResponse;
        if (pathname === "/api/auth/google/start") return await handleGoogleAuthStart(request);
        if (pathname === "/api/auth/google/callback") return await handleGoogleAuthCallback(request);
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
