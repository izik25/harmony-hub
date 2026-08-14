import type { OAuthPlatformId } from "./types";

export const OAUTH_PLATFORM_IDS: OAuthPlatformId[] = ["youtube", "tiktok", "instagram"];

export const SHARE_ONLY_PLATFORM_IDS = ["spotify", "apple_music", "soundcloud"] as const;
export type ShareOnlyPlatformId = (typeof SHARE_ONLY_PLATFORM_IDS)[number];

export function isOAuthPlatformId(v: string): v is OAuthPlatformId {
  return (OAUTH_PLATFORM_IDS as string[]).includes(v);
}

export function redirectUriFor(origin: string, platform: OAuthPlatformId): string {
  return `${origin}/api/connect/${platform}/callback`;
}
