import type { PublishInput, PublishResult, SocialPlatform, TokenSet } from "./types";

// Instagram Reels via the Meta Graph API. Requires a Meta app (Meta for Developers) with
// "Instagram Graph API" added, set META_APP_ID / META_APP_SECRET in .env, and
// {origin}/api/connect/instagram/callback registered as a valid OAuth redirect URI.
//
// Hard requirement this code can't route around: the connecting account must be an Instagram
// Business or Creator account linked to a Facebook Page — a plain personal Instagram account has
// no Graph API access at all, so "Connect" will fail at the page-lookup step for anyone without
// one. Also unlike YouTube/TikTok, Meta fetches the video from `videoUrl` itself rather than us
// pushing bytes, so the synthesized video must already be sitting at a public URL before this runs.
const GRAPH_VERSION = "v21.0";
const SCOPES = "instagram_basic,instagram_content_publish,pages_show_list,business_management";

function configured(): boolean {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

async function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  const shortLivedUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  shortLivedUrl.searchParams.set("client_id", process.env.META_APP_ID!);
  shortLivedUrl.searchParams.set("client_secret", process.env.META_APP_SECRET!);
  shortLivedUrl.searchParams.set("redirect_uri", redirectUri);
  shortLivedUrl.searchParams.set("code", code);
  const shortLivedRes = await fetch(shortLivedUrl);
  if (!shortLivedRes.ok)
    throw new Error(`instagramTokenExchangeFailed:${await shortLivedRes.text()}`);
  const shortLived = (await shortLivedRes.json()) as { access_token: string };

  // Short-lived user tokens expire in ~1-2h; exchange for a long-lived one (~60 days) up front so
  // reconnecting isn't required almost immediately after connecting.
  const longLivedUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
  longLivedUrl.searchParams.set("client_id", process.env.META_APP_ID!);
  longLivedUrl.searchParams.set("client_secret", process.env.META_APP_SECRET!);
  longLivedUrl.searchParams.set("fb_exchange_token", shortLived.access_token);
  const longLivedRes = await fetch(longLivedUrl);
  if (!longLivedRes.ok)
    throw new Error(`instagramTokenExchangeFailed:${await longLivedRes.text()}`);
  const longLived = (await longLivedRes.json()) as { access_token: string; expires_in: number };

  const pagesUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,instagram_business_account{id,username}");
  pagesUrl.searchParams.set("access_token", longLived.access_token);
  const pagesRes = await fetch(pagesUrl);
  if (!pagesRes.ok) throw new Error(`instagramPageLookupFailed:${await pagesRes.text()}`);
  const pages = (await pagesRes.json()) as {
    data: Array<{
      id: string;
      name: string;
      instagram_business_account?: { id: string; username: string };
    }>;
  };
  const withIg = pages.data.find((p) => p.instagram_business_account);
  if (!withIg?.instagram_business_account) {
    throw new Error("instagramNoBusinessAccountLinked");
  }

  return {
    accessToken: longLived.access_token,
    refreshToken: "",
    expiresAt: new Date(Date.now() + longLived.expires_in * 1000),
    externalAccountId: withIg.instagram_business_account.id,
    externalAccountName: `@${withIg.instagram_business_account.username}`,
  };
}

async function ensureFreshToken(): Promise<{ accessToken: string; expiresAt: Date | null } | null> {
  // Meta's long-lived user tokens have no refresh_token grant — once the ~60 day token expires the
  // user has to reconnect. Nothing to refresh proactively here.
  return null;
}

async function publishVideo(input: PublishInput): Promise<PublishResult> {
  const createUrl = new URL(
    `https://graph.facebook.com/${GRAPH_VERSION}/${input.externalAccountId}/media`,
  );
  createUrl.searchParams.set("media_type", "REELS");
  createUrl.searchParams.set("video_url", input.videoUrl);
  createUrl.searchParams.set("caption", `${input.title}\n\n${input.description}`.trim());
  createUrl.searchParams.set("access_token", input.accessToken);
  const createRes = await fetch(createUrl, { method: "POST" });
  if (!createRes.ok) throw new Error(`instagramContainerCreateFailed:${await createRes.text()}`);
  const created = (await createRes.json()) as { id: string };

  // Meta downloads and transcodes the video async — poll status_code until it flips out of
  // IN_PROGRESS. Bounded to ~2 minutes; if it's still processing after that we bail with a clear
  // error rather than hanging the request open indefinitely on a serverless function.
  const statusUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${created.id}`);
  statusUrl.searchParams.set("fields", "status_code");
  statusUrl.searchParams.set("access_token", input.accessToken);
  let statusCode = "IN_PROGRESS";
  for (let i = 0; i < 24 && statusCode === "IN_PROGRESS"; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(statusUrl);
    if (!statusRes.ok) throw new Error(`instagramStatusCheckFailed:${await statusRes.text()}`);
    const status = (await statusRes.json()) as { status_code: string };
    statusCode = status.status_code;
  }
  if (statusCode !== "FINISHED") throw new Error(`instagramContainerNotReady:${statusCode}`);

  const publishUrl = new URL(
    `https://graph.facebook.com/${GRAPH_VERSION}/${input.externalAccountId}/media_publish`,
  );
  publishUrl.searchParams.set("creation_id", created.id);
  publishUrl.searchParams.set("access_token", input.accessToken);
  const publishRes = await fetch(publishUrl, { method: "POST" });
  if (!publishRes.ok) throw new Error(`instagramPublishFailed:${await publishRes.text()}`);
  const published = (await publishRes.json()) as { id: string };

  const permalinkUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${published.id}`);
  permalinkUrl.searchParams.set("fields", "permalink");
  permalinkUrl.searchParams.set("access_token", input.accessToken);
  const permalinkRes = await fetch(permalinkUrl);
  const permalink = permalinkRes.ok
    ? ((await permalinkRes.json()) as { permalink?: string }).permalink
    : undefined;

  return { externalId: published.id, externalUrl: permalink ?? "" };
}

export const instagramPlatform: SocialPlatform = {
  id: "instagram",
  configured,
  authorizeUrl,
  exchangeCode,
  ensureFreshToken,
  publishVideo,
};
