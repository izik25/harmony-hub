// Shared types for the "Publish everywhere" OAuth-backed platforms (YouTube, TikTok, Instagram).
// Spotify/Apple Music/SoundCloud are handled entirely client-side as link-outs (see
// src/lib/social-platforms/share-only.ts) since none of them expose a public "upload as an
// independent artist" API — they're not part of this server-side contract at all.

export type OAuthPlatformId = "youtube" | "tiktok" | "instagram";

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  /** null when the platform's token doesn't expire / didn't report a lifetime. */
  expiresAt: Date | null;
  externalAccountId: string;
  externalAccountName: string;
};

export type PublishInput = {
  accessToken: string;
  externalAccountId: string;
  /** Publicly reachable URL (Vercel Blob) of the synthesized cover+audio video. */
  videoUrl: string;
  title: string;
  description: string;
};

export type PublishResult = {
  externalId: string;
  externalUrl: string;
  /** Set when the platform accepted the upload but won't make it public on its own — e.g. TikTok
   *  sandbox apps land content in the creator's inbox as a draft instead of posting directly. */
  note?: string;
};

export interface SocialPlatform {
  id: OAuthPlatformId;
  configured(): boolean;
  authorizeUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  /** Returns a fresh access token, refreshing against the platform if the stored one can expire. */
  ensureFreshToken(tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date | null;
  }): Promise<{ accessToken: string; expiresAt: Date | null } | null>;
  publishVideo(input: PublishInput): Promise<PublishResult>;
}
