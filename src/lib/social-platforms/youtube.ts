import type { PublishInput, PublishResult, SocialPlatform, TokenSet } from "./types";

// YouTube Data API v3 — resumable upload. Requires a Google Cloud project with the "YouTube Data
// API v3" enabled and an OAuth 2.0 Client ID (Web application) whose authorized redirect URIs
// include {origin}/api/connect/youtube/callback for every origin this app runs on (localhost dev
// + the production Vercel domain). Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.
const SCOPE =
  "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";

function configured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`youtubeTokenExchangeFailed:${await res.text()}`);
  return res.json();
}

async function fetchChannel(accessToken: string): Promise<{ id: string; title: string }> {
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`youtubeChannelLookupFailed:${await res.text()}`);
  const json = (await res.json()) as { items?: Array<{ id: string; snippet: { title: string } }> };
  const channel = json.items?.[0];
  if (!channel) throw new Error("youtubeNoChannelForAccount");
  return { id: channel.id, title: channel.snippet.title };
}

async function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  const tokens = await tokenRequest({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const channel = await fetchChannel(tokens.access_token);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    externalAccountId: channel.id,
    externalAccountName: channel.title,
  };
}

async function ensureFreshToken(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}): Promise<{ accessToken: string; expiresAt: Date | null } | null> {
  if (tokens.expiresAt && tokens.expiresAt.getTime() > Date.now() + 60_000) return null;
  if (!tokens.refreshToken) throw new Error("youtubeMissingRefreshToken");
  const refreshed = await tokenRequest({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
  });
  return {
    accessToken: refreshed.access_token,
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
  };
}

async function publishVideo(input: PublishInput): Promise<PublishResult> {
  const videoRes = await fetch(input.videoUrl);
  if (!videoRes.ok || !videoRes.body) throw new Error("youtubeCouldNotFetchSourceVideo");
  const videoBlob = await videoRes.blob();

  // Resumable upload: step 1 registers the metadata and gets a per-session upload URL back in the
  // Location header; step 2 PUTs the actual bytes to that URL. Two requests, but keeps the byte
  // stream separate from the JSON metadata call, which is what the API requires for resumable mode.
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": videoBlob.type || "video/mp4",
        "x-upload-content-length": String(videoBlob.size),
      },
      body: JSON.stringify({
        snippet: {
          title: input.title.slice(0, 100),
          description: input.description,
          categoryId: "10", // Music
        },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      }),
    },
  );
  if (!initRes.ok) throw new Error(`youtubeUploadInitFailed:${await initRes.text()}`);
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("youtubeMissingUploadUrl");

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": videoBlob.type || "video/mp4" },
    body: videoBlob,
  });
  if (!uploadRes.ok) throw new Error(`youtubeUploadFailed:${await uploadRes.text()}`);
  const video = (await uploadRes.json()) as { id: string };
  return { externalId: video.id, externalUrl: `https://youtube.com/shorts/${video.id}` };
}

export const youtubePlatform: SocialPlatform = {
  id: "youtube",
  configured,
  authorizeUrl,
  exchangeCode,
  ensureFreshToken,
  publishVideo,
};
