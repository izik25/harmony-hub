import type { OAuthPlatformId, SocialPlatform } from "./types";
import { youtubePlatform } from "./youtube";
import { tiktokPlatform } from "./tiktok";
import { instagramPlatform } from "./instagram";

export const socialPlatforms: Record<OAuthPlatformId, SocialPlatform> = {
  youtube: youtubePlatform,
  tiktok: tiktokPlatform,
  instagram: instagramPlatform,
};

export * from "./types";
export * from "./config";
