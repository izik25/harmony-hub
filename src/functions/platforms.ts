import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { platformConnections, platformPublishes, posts } from "@/db/schema";
import {
  socialPlatforms,
  OAUTH_PLATFORM_IDS,
  SHARE_ONLY_PLATFORM_IDS,
  type OAuthPlatformId,
} from "@/lib/social-platforms";
import { requireUserId } from "./auth";

export type PlatformStatusDTO = {
  platform: string;
  kind: "oauth" | "link";
  configured: boolean;
  connected: boolean;
  accountName: string;
};

export const listPlatformStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlatformStatusDTO[]> => {
    const userId = await requireUserId();
    const connections = await db
      .select()
      .from(platformConnections)
      .where(eq(platformConnections.userId, userId));
    const byPlatform = new Map(connections.map((c) => [c.platform, c]));

    const oauthStatuses: PlatformStatusDTO[] = OAUTH_PLATFORM_IDS.map((platform) => {
      const conn = byPlatform.get(platform);
      return {
        platform,
        kind: "oauth",
        configured: socialPlatforms[platform].configured(),
        connected: !!conn,
        accountName: conn?.externalAccountName ?? "",
      };
    });

    const linkStatuses: PlatformStatusDTO[] = SHARE_ONLY_PLATFORM_IDS.map((platform) => ({
      platform,
      kind: "link",
      configured: true,
      connected: true,
      accountName: "",
    }));

    return [...oauthStatuses, ...linkStatuses];
  },
);

export const disconnectPlatform = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { platform: OAuthPlatformId })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await db
      .delete(platformConnections)
      .where(
        and(
          eq(platformConnections.userId, userId),
          eq(platformConnections.platform, data.platform),
        ),
      );
    return { ok: true };
  });

export type PublishStatusDTO = {
  platform: string;
  status: string;
  externalUrl: string;
  error: string;
};

export const getPublishStatuses = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { postId: string })
  .handler(async ({ data }): Promise<PublishStatusDTO[]> => {
    const userId = await requireUserId();
    const rows = await db
      .select()
      .from(platformPublishes)
      .where(and(eq(platformPublishes.postId, data.postId), eq(platformPublishes.userId, userId)));
    return rows.map((r) => ({
      platform: r.platform,
      status: r.status,
      externalUrl: r.externalUrl,
      error: r.error,
    }));
  });

async function upsertPublishRecord(
  postId: string,
  userId: string,
  platform: OAuthPlatformId,
  patch: { status: string; externalUrl?: string; externalId?: string; error?: string },
) {
  const [existing] = await db
    .select()
    .from(platformPublishes)
    .where(
      and(
        eq(platformPublishes.postId, postId),
        eq(platformPublishes.userId, userId),
        eq(platformPublishes.platform, platform),
      ),
    );
  if (existing) {
    await db
      .update(platformPublishes)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(platformPublishes.id, existing.id));
  } else {
    await db.insert(platformPublishes).values({ postId, userId, platform, ...patch });
  }
}

async function publishOne(
  postId: string,
  userId: string,
  platform: OAuthPlatformId,
  videoUrl: string,
  title: string,
  description: string,
): Promise<PublishStatusDTO> {
  const social = socialPlatforms[platform];
  try {
    const [conn] = await db
      .select()
      .from(platformConnections)
      .where(
        and(eq(platformConnections.userId, userId), eq(platformConnections.platform, platform)),
      );
    if (!conn) throw new Error("notConnected");

    let accessToken = conn.accessToken;
    const refreshed = await social.ensureFreshToken({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      expiresAt: conn.expiresAt,
    });
    if (refreshed) {
      accessToken = refreshed.accessToken;
      await db
        .update(platformConnections)
        .set({ accessToken, expiresAt: refreshed.expiresAt, updatedAt: new Date() })
        .where(eq(platformConnections.id, conn.id));
    }

    await upsertPublishRecord(postId, userId, platform, { status: "processing" });
    const result = await social.publishVideo({
      accessToken,
      externalAccountId: conn.externalAccountId,
      videoUrl,
      title,
      description,
    });
    await upsertPublishRecord(postId, userId, platform, {
      status: "success",
      externalUrl: result.externalUrl,
      externalId: result.externalId,
      error: result.note ?? "",
    });
    return {
      platform,
      status: "success",
      externalUrl: result.externalUrl,
      error: result.note ?? "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "publishFailed";
    await upsertPublishRecord(postId, userId, platform, { status: "failed", error: message });
    return { platform, status: "failed", externalUrl: "", error: message };
  }
}

export const publishToPlatforms = createServerFn({ method: "POST" })
  .validator(
    (input: unknown) =>
      input as {
        postId: string;
        platforms: OAuthPlatformId[];
        videoUrl: string;
        title: string;
        description: string;
      },
  )
  .handler(async ({ data }): Promise<PublishStatusDTO[]> => {
    const userId = await requireUserId();
    const [post] = await db.select().from(posts).where(eq(posts.id, data.postId));
    if (!post || post.userId !== userId) throw new Error("postNotFound");

    const results = await Promise.all(
      data.platforms.map((platform) =>
        publishOne(data.postId, userId, platform, data.videoUrl, data.title, data.description),
      ),
    );
    return results;
  });
