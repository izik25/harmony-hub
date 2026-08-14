import type { PublishInput, PublishResult, SocialPlatform, TokenSet } from "./types";

// TikTok Content Posting API. Requires a TikTok for Developers app with the "Content Posting API"
// product added; set TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET in .env, and register
// {origin}/api/connect/tiktok/callback as a redirect URI for every origin this app runs on.
//
// Important real-world caveat (not something this code can work around): until TikTok reviews and
// approves the app for public "Direct Post", uploads from unaudited apps land in the connected
// creator's TikTok inbox as a draft rather than posting publicly — the creator has to open TikTok
// and tap Post themselves. publishVideo() surfaces that as a `note` on the result so the UI can
// tell the user what to expect instead of implying it's already live.
const SCOPES = "user.info.basic,video.publish";

function configured(): boolean {
  return !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    scope: SCOPES,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id: string;
}> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "no-cache",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`tiktokTokenExchangeFailed:${await res.text()}`);
  return res.json();
}

async function fetchDisplayName(accessToken: string): Promise<string> {
  const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "";
  const json = (await res.json()) as { data?: { user?: { display_name?: string } } };
  return json.data?.user?.display_name ?? "";
}

async function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  const tokens = await tokenRequest({
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    client_secret: process.env.TIKTOK_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const displayName = await fetchDisplayName(tokens.access_token);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    externalAccountId: tokens.open_id,
    externalAccountName: displayName || tokens.open_id,
  };
}

async function ensureFreshToken(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}): Promise<{ accessToken: string; expiresAt: Date | null } | null> {
  if (tokens.expiresAt && tokens.expiresAt.getTime() > Date.now() + 60_000) return null;
  if (!tokens.refreshToken) throw new Error("tiktokMissingRefreshToken");
  const refreshed = await tokenRequest({
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    client_secret: process.env.TIKTOK_CLIENT_SECRET!,
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
  if (!videoRes.ok) throw new Error("tiktokCouldNotFetchSourceVideo");
  const videoBlob = await videoRes.blob();

  const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: input.title.slice(0, 150),
        privacy_level: "SELF_ONLY",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoBlob.size,
        chunk_size: videoBlob.size,
        total_chunk_count: 1,
      },
    }),
  });
  if (!initRes.ok) throw new Error(`tiktokUploadInitFailed:${await initRes.text()}`);
  const init = (await initRes.json()) as {
    data: { publish_id: string; upload_url: string };
    error?: { code: string; message: string };
  };
  if (init.error && init.error.code !== "ok") {
    throw new Error(`tiktokUploadInitFailed:${init.error.message}`);
  }

  const uploadRes = await fetch(init.data.upload_url, {
    method: "PUT",
    headers: {
      "content-type": "video/mp4",
      "content-range": `bytes 0-${videoBlob.size - 1}/${videoBlob.size}`,
    },
    body: videoBlob,
  });
  if (!uploadRes.ok) throw new Error(`tiktokUploadFailed:${await uploadRes.text()}`);

  return {
    externalId: init.data.publish_id,
    externalUrl: "",
    note: "tiktokSentToInboxDraft",
  };
}

export const tiktokPlatform: SocialPlatform = {
  id: "tiktok",
  configured,
  authorizeUrl,
  exchangeCode,
  ensureFreshToken,
  publishVideo,
};
