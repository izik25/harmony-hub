import { useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  Youtube,
  Instagram,
  Music2,
  Apple,
  Cloud,
  Loader2,
  Check,
  ExternalLink,
  Link2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  listPlatformStatus,
  getPublishStatuses,
  publishToPlatforms,
  type PlatformStatusDTO,
} from "@/functions/platforms";
import { smartUploadMedia } from "@/lib/blob-upload";
import { renderCoverVideo } from "@/lib/video-synthesis";
import { shareToExternalPlatform } from "@/lib/social-platforms/share-only";
import type { OAuthPlatformId } from "@/lib/social-platforms";
import { translateServerError } from "@/lib/i18n";

type PublishablePost = {
  id: string;
  title: string;
  songTitle?: string;
  audioUrl: string;
  coverUrl: string;
  hue: number;
};

// TikTok has no lucide icon — a small inline glyph keeps this grid visually consistent with the
// rest of the platform rows instead of falling back to a generic music note for just one of them.
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M16.6 5.82c-.7-.77-1.13-1.76-1.2-2.82H12.9v13.3a2.8 2.8 0 1 1-2-2.68v-2.5a5.3 5.3 0 1 0 4.5 5.24V9.34a7.3 7.3 0 0 0 4.1 1.26v-2.5c-.98 0-2.15-.42-2.9-1.28z" />
    </svg>
  );
}

type PlatformIcon = ComponentType<{ className?: string }>;

const OAUTH_META: Record<OAuthPlatformId, { name: string; icon: PlatformIcon; color: string }> = {
  youtube: { name: "YouTube Shorts", icon: Youtube, color: "#FF0000" },
  tiktok: { name: "TikTok", icon: TikTokIcon, color: "#25F4EE" },
  instagram: { name: "Instagram Reels", icon: Instagram, color: "#E1306C" },
};

const LINK_META: Record<string, { name: string; icon: PlatformIcon; color: string }> = {
  spotify: { name: "Spotify", icon: Music2, color: "#1DB954" },
  apple_music: { name: "Apple Music", icon: Apple, color: "#FA57C1" },
  soundcloud: { name: "SoundCloud", icon: Cloud, color: "#FF5500" },
};

export function PublishEverywhereModal({
  open,
  onOpenChange,
  post,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: PublishablePost | null | undefined;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [videoProgress, setVideoProgress] = useState<"idle" | "rendering" | "uploading">("idle");

  const { data: statuses } = useQuery({
    queryKey: ["platformStatus"],
    queryFn: () => listPlatformStatus(),
    enabled: open,
  });
  const { data: publishStatuses } = useQuery({
    queryKey: ["publishStatuses", post?.id],
    queryFn: () => getPublishStatuses({ data: { postId: post!.id } }),
    enabled: open && !!post?.id,
  });
  const statusByPlatform = useMemo(
    () => new Map((publishStatuses ?? []).map((s) => [s.platform, s])),
    [publishStatuses],
  );

  const oauthStatuses = (statuses ?? []).filter(
    (s): s is PlatformStatusDTO & { platform: OAuthPlatformId } => s.kind === "oauth",
  );
  const linkStatuses = (statuses ?? []).filter((s) => s.kind === "link");

  const toggle = (platform: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!post) throw new Error("noMediaToPublish");
      const selectedOAuth = oauthStatuses
        .filter((s) => selected.has(s.platform) && s.connected)
        .map((s) => s.platform);
      const selectedLinks = linkStatuses.filter((s) => selected.has(s.platform));

      if (selectedOAuth.length > 0) {
        setVideoProgress("rendering");
        const { blob, isMp4 } = await renderCoverVideo({
          audioUrl: post.audioUrl,
          coverUrl: post.coverUrl,
          title: post.title,
          hue: post.hue,
        });
        if (selected.has("instagram") && !isMp4) {
          toast.warning(t("publishEverywhere.instagramNeedsMp4"));
        }
        setVideoProgress("uploading");
        const { url: videoUrl } = await smartUploadMedia(
          blob,
          `sona-share-${post.id}.${isMp4 ? "mp4" : "webm"}`,
        );
        setVideoProgress("idle");

        const results = await publishToPlatforms({
          data: {
            postId: post.id,
            platforms: selectedOAuth,
            videoUrl,
            title: post.songTitle || post.title,
            description: post.title,
          },
        });
        for (const r of results) {
          const meta = OAUTH_META[r.platform as OAuthPlatformId];
          if (r.status === "success") {
            toast.success(`${meta?.name ?? r.platform}: ${t("publishEverywhere.published")}`);
          } else {
            toast.error(`${meta?.name ?? r.platform}: ${translateServerError(r.error)}`);
          }
        }
        queryClient.invalidateQueries({ queryKey: ["publishStatuses", post.id] });
      }

      for (const link of selectedLinks) {
        await shareToExternalPlatform(link.platform as "spotify" | "apple_music" | "soundcloud", {
          audioUrl: post.audioUrl,
          title: post.songTitle || post.title,
        });
      }
    },
    onError: (e: Error) => {
      setVideoProgress("idle");
      toast.error(translateServerError(e.message));
    },
  });

  const connectPlatform = (platform: OAuthPlatformId) => {
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `/api/connect/${platform}/start?returnTo=${encodeURIComponent(returnTo)}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("publishEverywhere.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("publishEverywhere.subtitle")}</p>

        <div className="mt-3 space-y-2">
          {oauthStatuses.map((s) => {
            const meta = OAUTH_META[s.platform];
            const Icon = meta.icon;
            const pubStatus = statusByPlatform.get(s.platform);
            return (
              <div
                key={s.platform}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-pop"
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                  style={{ background: `${meta.color}22`, color: meta.color }}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{meta.name}</p>
                  {!s.configured ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("publishEverywhere.notConfigured")}
                    </p>
                  ) : s.connected ? (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {s.accountName || t("publishEverywhere.connected")}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      {t("publishEverywhere.notConnected")}
                    </p>
                  )}
                  {pubStatus?.status === "success" && pubStatus.externalUrl && (
                    <a
                      href={pubStatus.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-accent underline"
                    >
                      {t("publishEverywhere.viewPost")} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {pubStatus?.status === "failed" && (
                    <p className="mt-0.5 text-[11px] text-destructive">
                      {translateServerError(pubStatus.error)}
                    </p>
                  )}
                </div>
                {!s.configured ? null : !s.connected ? (
                  <button
                    onClick={() => connectPlatform(s.platform)}
                    className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent press-scale"
                  >
                    {t("publishEverywhere.connect")}
                  </button>
                ) : (
                  <motion.button
                    whileTap={{ scale: 0.85 }}
                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    onClick={() => toggle(s.platform)}
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${
                      selected.has(s.platform)
                        ? "border-accent bg-accent text-white"
                        : "border-border"
                    }`}
                  >
                    <AnimatePresence>
                      {selected.has(s.platform) && (
                        <motion.span
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 500, damping: 22 }}
                        >
                          <Check className="h-4 w-4" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("publishEverywhere.linkOutTitle")}
        </p>
        <div className="space-y-2">
          {linkStatuses.map((s) => {
            const meta = LINK_META[s.platform];
            const Icon = meta.icon;
            return (
              <div
                key={s.platform}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-pop"
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                  style={{ background: `${meta.color}22`, color: meta.color }}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{meta.name}</p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Link2 className="h-3 w-3" /> {t("publishEverywhere.linkOutDesc")}
                  </p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  transition={{ type: "spring", stiffness: 500, damping: 25 }}
                  onClick={() => toggle(s.platform)}
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${
                    selected.has(s.platform)
                      ? "border-accent bg-accent text-white"
                      : "border-border"
                  }`}
                >
                  <AnimatePresence>
                    {selected.has(s.platform) && (
                      <motion.span
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 22 }}
                      >
                        <Check className="h-4 w-4" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              </div>
            );
          })}
        </div>

        <motion.button
          whileTap={{ scale: 0.97 }}
          whileHover={{ scale: 1.01, y: -2 }}
          transition={{ type: "spring", stiffness: 400, damping: 26 }}
          onClick={() => publishMutation.mutate()}
          disabled={selected.size === 0 || publishMutation.isPending || !post}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-brand-coral py-3 text-sm font-bold text-white shadow-pop-coral disabled:opacity-50"
        >
          {publishMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {videoProgress === "rendering"
                ? t("publishEverywhere.renderingVideo")
                : videoProgress === "uploading"
                  ? t("publishEverywhere.uploadingVideo")
                  : t("publishEverywhere.publishing")}
            </>
          ) : (
            t("publishEverywhere.publishSelected", { count: selected.size })
          )}
        </motion.button>
        <button
          onClick={() => onOpenChange(false)}
          className="mt-2 w-full rounded-full border border-border bg-card py-2.5 text-sm font-semibold press-scale"
        >
          {t("common.done")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
