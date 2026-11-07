import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import {
  Heart,
  MessageCircle,
  Share2,
  Gift,
  Music,
  Trophy,
  BadgeCheck,
  Volume2,
  VolumeX,
  Send,
  Check,
  Plus,
  Mic,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { LevelMeter } from "@/components/LevelMeter";
import { GiftGlyph } from "@/components/GiftGlyph";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCount } from "@/lib/mock-data";
import { translateServerError } from "@/lib/i18n";
import { shareContent } from "@/lib/share";
import {
  listFeed,
  toggleLike,
  toggleFollow,
  sharePost,
  listComments,
  addComment,
  type FeedPostDTO,
} from "@/functions/posts";
import { listGiftCatalog, sendGift } from "@/functions/wallet";
import { useViewTracker } from "@/hooks/use-view-tracker";

export const Route = createFileRoute("/")({
  component: HomePage,
});

// The wall is an infinite, personalized feed: every page is ranked server-side against the
// viewer's interest profile as it stands *now* (functions/recommendations.ts), excluding what's
// already loaded — so what you watch on page 1 shapes page 2.
type FeedPages = InfiniteData<FeedPostDTO[], string[]>;

/** Applies `fn` to every loaded feed post (optimistic like/follow/comment/... updates). */
function patchFeed(queryClient: QueryClient, fn: (p: FeedPostDTO) => FeedPostDTO) {
  queryClient.setQueryData<FeedPages>(["feed"], (old) =>
    old ? { ...old, pages: old.pages.map((page) => page.map(fn)) } : old,
  );
}

function HomePage() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useInfiniteQuery({
    queryKey: ["feed"],
    queryFn: ({ pageParam }) => listFeed({ data: { excludeIds: pageParam } }),
    initialPageParam: [] as string[],
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 0 ? undefined : allPages.flat().map((p) => p.id),
    // A re-rank while you're mid-scroll would reshuffle the posts under your thumb.
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const posts = useMemo(() => {
    const seen = new Set<string>();
    return (data?.pages.flat() ?? []).filter((p) => !seen.has(p.id) && !!seen.add(p.id));
  }, [data]);

  return (
    <AppShell overlayNav width="feed">
      <TopBar transparent />
      <div className="relative -mt-14 lg:mt-0">
        {isPending ? (
          <FeedStage>
            <LevelMeter live bars={14} className="h-16 w-40 opacity-80" />
          </FeedStage>
        ) : posts.length === 0 ? (
          <FeedEmpty />
        ) : (
          <FeedSlider
            posts={posts}
            onNearEnd={() => {
              if (hasNextPage && !isFetchingNextPage) fetchNextPage();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

/** Full-height dark stage the feed's non-post states sit on. */
function FeedStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-[var(--surface-sunken)] px-8 text-center">
      {children}
    </div>
  );
}

// Pre-launch the feed is genuinely empty. Say so plainly and hand over the one useful action,
// instead of a black screen that looks broken.
function FeedEmpty() {
  const { t } = useTranslation();
  return (
    <FeedStage>
      <LevelMeter bars={14} className="h-20 w-44" />
      <h1 className="mt-8 text-2xl">{t("feed.emptyTitle")}</h1>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">{t("feed.emptyBody")}</p>
      <Link
        to="/record"
        className="mt-6 inline-flex h-12 items-center gap-2 rounded-xl bg-brand-coral px-6 text-sm font-bold text-white shadow-pop-coral transition-[filter] hover:brightness-110 press-scale"
      >
        <Mic className="h-4 w-4" />
        {t("common.record")}
      </Link>
    </FeedStage>
  );
}

function FeedSlider({ posts, onNearEnd }: { posts: FeedPostDTO[]; onNearEnd: () => void }) {
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [giftFor, setGiftFor] = useState<FeedPostDTO | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Only one post is ever ~fully visible at a time in a snap-scroll feed, so whichever section
  // crosses the intersection threshold is "the one playing" — same idea as TikTok/Reels.
  // `activeId` is intentionally NOT a dependency here: reading it inside the effect (instead of
  // via a functional setState) would tear down and recreate the observer on every single scroll
  // transition, and a freshly-created IntersectionObserver takes a frame to report its first
  // intersection — during fast scrolling that gap was dropping transitions entirely, which is
  // exactly "scrolling doesn't play the next one".
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-post-id]"));
    if (sections.length === 0) return;

    setActiveId((current) => current ?? sections[0].dataset.postId ?? null);

    const observer = new IntersectionObserver(
      (entries) => {
        let best: { id: string; ratio: number } | null = null;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.postId;
          if (!id || !entry.isIntersecting) continue;
          if (!best || entry.intersectionRatio > best.ratio)
            best = { id, ratio: entry.intersectionRatio };
        }
        if (best) setActiveId(best.id);
      },
      { root: container, threshold: [0.6] },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [posts]);

  // Fetch the next ranked page a few posts before the end, so scrolling never hits a wall.
  const activeIndex = posts.findIndex((x) => x.id === activeId);
  useEffect(() => {
    if (activeIndex >= 0 && activeIndex >= posts.length - 4) onNearEnd();
  }, [activeIndex, posts.length, onNearEnd]);

  const unmute = () => {
    setHasInteracted(true);
    setMuted(false);
  };

  return (
    <div
      ref={containerRef}
      onClick={() => {
        if (!hasInteracted) unmute();
      }}
      className="h-dvh snap-y snap-mandatory overflow-y-auto no-scrollbar"
    >
      {posts.map((p, i) => {
        // Full preload for the playing post, a lightweight metadata head-start for its immediate
        // neighbor (whichever way the user scrolls next), nothing for everything else — loading
        // audio for all 50 feed posts at once (the old blanket "metadata" preload) is exactly
        // what was making the very first post take forever to start.
        const preload =
          p.id === activeId ? "auto" : Math.abs(i - activeIndex) === 1 ? "metadata" : "none";
        return (
          <FeedItem
            key={p.id}
            post={p}
            active={p.id === activeId}
            preload={preload}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            showSoundHint={!hasInteracted && p.id === activeId}
            onOpenComments={() => setCommentsFor(p.id)}
            onOpenGift={() => setGiftFor(p)}
          />
        );
      })}
      <CommentsSheet postId={commentsFor} onClose={() => setCommentsFor(null)} />
      <GiftSheet post={giftFor} onClose={() => setGiftFor(null)} />
    </div>
  );
}

function FeedItem({
  post,
  active,
  preload,
  muted,
  onToggleMute,
  showSoundHint,
  onOpenComments,
  onOpenGift,
}: {
  post: FeedPostDTO;
  active: boolean;
  preload: "auto" | "metadata" | "none";
  muted: boolean;
  onToggleMute: () => void;
  showSoundHint: boolean;
  onOpenComments: () => void;
  onOpenGift: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // <audio> for a normal post, <video> for one with a self-recorded/uploaded performance video
  // (see the JSX below) — every API these effects use (.play/.pause/.currentTime/.muted, the
  // play/pause/timeupdate events) is identical on both, so one ref/effect set covers both.
  const audioRef = useRef<HTMLMediaElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  useViewTracker(post.id, active, audioRef);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (active) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else {
      audio.pause();
      setIsPlaying(false);
      setProgress(0);
    }
  }, [active]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.muted = muted;
  }, [muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime);
    };
  }, []);

  const likeMutation = useMutation({
    mutationFn: () => toggleLike({ data: { postId: post.id } }),
    onMutate: async () => {
      patchFeed(queryClient, (p) =>
        p.id === post.id
          ? { ...p, likedByMe: !p.likedByMe, likes: p.likes + (p.likedByMe ? -1 : 1) }
          : p,
      );
    },
  });

  const followMutation = useMutation({
    mutationFn: () => toggleFollow({ data: { userId: post.user.id } }),
    onMutate: async () => {
      patchFeed(queryClient, (p) =>
        p.user.id === post.user.id ? { ...p, followingAuthor: !p.followingAuthor } : p,
      );
    },
  });

  const shareMutation = useMutation({
    mutationFn: async () => {
      const url = `${window.location.origin}/?post=${post.id}`;
      const result = await shareContent({ title: post.title, url });
      if (result === "cancelled") return result;
      await sharePost({ data: { postId: post.id } });
      return result;
    },
    onSuccess: (result) => {
      if (result === "cancelled") return;
      patchFeed(queryClient, (p) => (p.id === post.id ? { ...p, shares: p.shares + 1 } : p));
      if (result === "copied") toast.success(t("common.linkCopied"));
    },
  });

  const typeLabel: Record<string, string> = {
    cover: t("feed.cover"),
    original: t("feed.original"),
    djset: t("feed.djset"),
    teaser: t("feed.teaser"),
    competition: t("common.live"),
  };

  // Double-tap-to-like on the cover art itself, same gesture as Reels/TikTok. Tracked with a
  // plain ref (not state) since the tap timing itself never needs to trigger a render — only its
  // outcome (the heart burst) does.
  const lastTapRef = useRef(0);
  const [burstKey, setBurstKey] = useState(0);
  const [showBurst, setShowBurst] = useState(false);
  const handleCoverTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!post.likedByMe) likeMutation.mutate();
      setBurstKey((k) => k + 1);
      setShowBurst(true);
    }
    lastTapRef.current = now;
  };
  useEffect(() => {
    if (!showBurst) return;
    const timer = setTimeout(() => setShowBurst(false), 650);
    return () => clearTimeout(timer);
  }, [showBurst]);

  return (
    <section
      data-post-id={post.id}
      style={{ scrollSnapStop: "always" }}
      className="relative h-dvh snap-start overflow-hidden"
    >
      <motion.div
        onClick={handleCoverTap}
        initial={false}
        animate={{ scale: active ? 1 : 1.05 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className={isPlaying ? "absolute inset-0 animate-cover-breathe" : "absolute inset-0"}
      >
        {post.videoUrl ? (
          <video
            ref={audioRef as RefObject<HTMLVideoElement>}
            src={post.videoUrl}
            loop
            muted={muted}
            playsInline
            preload={preload}
            className="h-full w-full object-cover"
          />
        ) : (
          <>
            {post.audioUrl && (
              <audio
                ref={audioRef as RefObject<HTMLAudioElement>}
                src={post.audioUrl}
                loop
                muted={muted}
                playsInline
                preload={preload}
              />
            )}
            <PostCoverBg hue={post.hue} seed={post.id} imageUrl={post.coverUrl} />
          </>
        )}
      </motion.div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/80" />

      <AnimatePresence>
        {showBurst && (
          <motion.div
            key={burstKey}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1.15, opacity: 1 }}
            exit={{ scale: 1.35, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          >
            <Heart className="h-24 w-24 fill-white text-white drop-shadow-lg" />
          </motion.div>
        )}
      </AnimatePresence>

      {showSoundHint && (post.audioUrl || post.videoUrl) && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center">
          <span className="animate-sound-hint flex items-center gap-2 rounded-full glass border border-white/20 px-4 py-2 text-xs font-semibold text-white">
            <VolumeX className="h-3.5 w-3.5" />
            {t("feed.tapForSound")}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-white/10">
        <div
          className="h-full bg-white/70 transition-[width] duration-150 ease-linear"
          style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
        />
      </div>

      <motion.div
        initial={false}
        animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="absolute start-4 top-16 z-10 flex items-center gap-2 lg:top-4"
      >
        <span className="rounded-full glass px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90">
          {typeLabel[post.type] ?? post.type}
        </span>
        {post.type === "competition" && (
          <span className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-primary-foreground">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ring-pulse rounded-full bg-white" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            {t("common.live")}
          </span>
        )}
      </motion.div>

      <motion.div
        initial={false}
        animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: active ? 0.05 : 0 }}
        className="absolute bottom-32 end-3 z-10 flex flex-col items-center gap-5"
      >
        <div className="relative">
          <img
            src={post.user.avatar}
            alt=""
            className="h-12 w-12 rounded-full border-2 border-white/80"
          />
          {/* Small visible badge, 32px hit area around it. */}
          <motion.button
            onClick={() => followMutation.mutate()}
            whileTap={{ scale: 0.85 }}
            aria-label={t(post.followingAuthor ? "common.following" : "common.follow")}
            aria-pressed={post.followingAuthor}
            className="absolute -bottom-3.5 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center"
          >
            <span
              className={`grid h-5 w-5 place-items-center overflow-hidden rounded-full text-white ring-2 ring-black/30 ${
                post.followingAuthor ? "bg-secondary" : "bg-brand-coral"
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={post.followingAuthor ? "on" : "off"}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.4, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {post.followingAuthor ? (
                    <Check className="h-3 w-3" strokeWidth={3} />
                  ) : (
                    <Plus className="h-3 w-3" strokeWidth={3} />
                  )}
                </motion.span>
              </AnimatePresence>
            </span>
          </motion.button>
        </div>
        <ActionButton
          onClick={() => likeMutation.mutate()}
          label={t("common.like")}
          pressed={post.likedByMe}
          icon={
            <motion.span
              key={post.likes}
              initial={{ scale: post.likedByMe ? 0.5 : 1 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 15 }}
              className="block"
            >
              <Heart
                className={`h-7 w-7 ${post.likedByMe ? "fill-primary text-brand-coral" : ""}`}
              />
            </motion.span>
          }
          count={formatCount(post.likes)}
        />
        <ActionButton
          onClick={onOpenComments}
          label={t("feed.comments")}
          icon={<MessageCircle className="h-7 w-7" />}
          count={formatCount(post.comments)}
        />
        <ActionButton
          onClick={onOpenGift}
          label={t("common.gift")}
          icon={<Gift className="h-7 w-7 text-accent" />}
          count={formatCount(post.gifts)}
        />
        <ActionButton
          onClick={() => shareMutation.mutate()}
          label={t("common.share")}
          icon={<Share2 className="h-7 w-7" />}
          count={formatCount(post.shares)}
        />
        {post.karaokeTrackId ? (
          <Link
            to="/sound/$id"
            params={{ id: post.karaokeTrackId }}
            aria-label={t("feed.viewSound")}
            className={`grid h-10 w-10 place-items-center rounded-full glass ${isPlaying ? "animate-spin-fast" : ""}`}
          >
            <Music className="h-5 w-5 text-white" />
          </Link>
        ) : (
          // No sound page to open: a spinning disc that shows playback, not a dead button.
          <span
            aria-hidden
            className={`grid h-10 w-10 place-items-center rounded-full glass ${isPlaying ? "animate-spin-fast" : ""}`}
          >
            <Music className="h-5 w-5 text-white" />
          </span>
        )}
      </motion.div>

      <motion.div
        initial={false}
        animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: active ? 0.1 : 0 }}
        className="absolute inset-x-0 bottom-0 z-10 p-4 pe-20 pb-24"
      >
        <Link
          to="/profile/$handle"
          params={{ handle: post.user.handle }}
          className="flex items-center gap-2 text-white"
        >
          <span className="font-display text-base font-bold">{post.user.name}</span>
          {post.user.verified && <BadgeCheck className="h-4 w-4 text-accent" />}
          <bdi className="text-xs text-white/70">@{post.user.handle}</bdi>
        </Link>
        <p className="mt-1 text-sm text-white/90">
          <bdi>{post.title}</bdi>
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs text-white/80">
          {post.audioUrl || post.videoUrl ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleMute();
              }}
              aria-label={t(muted ? "feed.unmute" : "feed.mute")}
              className="shrink-0"
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
          {post.karaokeTrackId ? (
            <Link
              to="/sound/$id"
              params={{ id: post.karaokeTrackId }}
              onClick={(e) => e.stopPropagation()}
              className="line-clamp-1 flex min-w-0 items-center gap-1 font-semibold hover:underline"
            >
              <Music className="h-3 w-3 shrink-0" />
              <span className="line-clamp-1">{post.song}</span>
            </Link>
          ) : (
            <span className="line-clamp-1">{post.song}</span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Was a button on every post that did nothing; now a real way into competitions,
              loud only on competition entries. */}
          <Link
            to="/competitions"
            onClick={(e) => e.stopPropagation()}
            className={
              post.type === "competition"
                ? "inline-flex h-8 items-center rounded-lg bg-brand-coral px-3 text-xs font-bold text-white press-scale"
                : "inline-flex h-8 items-center rounded-lg border border-white/20 bg-black/25 px-3 text-xs font-semibold text-white backdrop-blur-sm press-scale"
            }
          >
            <Trophy className="me-1 h-3.5 w-3.5" />
            {t("feed.competition")}
          </Link>
          <CreditsPop credits={post.credits} />
        </div>
      </motion.div>
    </section>
  );
}

function ActionButton({
  icon,
  count,
  onClick,
  label,
  pressed,
}: {
  icon: React.ReactNode;
  count?: string;
  onClick?: () => void;
  label: string;
  pressed?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.85 }}
      onClick={onClick}
      aria-label={count ? `${label} · ${count}` : label}
      aria-pressed={pressed}
      className="flex flex-col items-center gap-1 text-white"
    >
      <div className="grid h-11 w-11 place-items-center rounded-full glass">{icon}</div>
      {count && <span className="text-[11px] font-semibold">{count}</span>}
    </motion.button>
  );
}

function CreditsPop({ credits }: { credits: FeedPostDTO["credits"] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full glass border border-white/20 px-3 py-1.5 text-[11px] font-semibold text-white/90"
      >
        {t("feed.credits")}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-full mb-2 w-56 rounded-2xl glass border border-border p-3 text-[11px]"
          >
            <Row k={t("upload.performer")} v={credits.performer} />
            <Row k={t("upload.writer")} v={credits.writer} />
            <Row k={t("upload.composer")} v={credits.composer} />
            <Row k={t("upload.producer")} v={credits.producer} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-white">{v}</span>
    </div>
  );
}

function CommentsSheet({ postId, onClose }: { postId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const { data: comments } = useQuery({
    queryKey: ["comments", postId],
    queryFn: () => listComments({ data: { postId: postId! } }),
    enabled: !!postId,
  });

  const addMutation = useMutation({
    mutationFn: () => addComment({ data: { postId: postId!, body } }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["comments", postId] });
      patchFeed(queryClient, (p) => (p.id === postId ? { ...p, comments: p.comments + 1 } : p));
    },
  });

  return (
    <Sheet open={!!postId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="flex h-[70vh] flex-col rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>{t("feed.comments")}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto py-2">
          {comments?.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("feed.noComments")}</p>
          )}
          {comments?.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <img src={c.user.avatar} className="h-8 w-8 rounded-full" alt="" />
              <div>
                <p className="text-sm font-semibold">{c.user.name}</p>
                <p className="bidi-auto text-sm">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
        <form
          className="flex items-center gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) addMutation.mutate();
          }}
        >
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("feed.addComment")}
            aria-label={t("feed.addComment")}
            className="input flex-1"
          />
          <button
            type="submit"
            aria-label={t("common.send")}
            disabled={!body.trim() || addMutation.isPending}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-coral transition-opacity press-scale disabled:opacity-40"
          >
            <Send className="h-5 w-5 text-white rtl:-scale-x-100" />
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function GiftSheet({ post, onClose }: { post: FeedPostDTO | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: gifts } = useQuery({
    queryKey: ["giftCatalog"],
    queryFn: () => listGiftCatalog(),
    enabled: !!post,
  });

  const giftMutation = useMutation({
    mutationFn: (giftId: string) =>
      sendGift({ data: { toUserId: post!.user.id, giftId, postId: post!.id } }),
    onSuccess: () => {
      patchFeed(queryClient, (p) => (p.id === post!.id ? { ...p, gifts: p.gifts + 1 } : p));
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      toast.success(t("feed.giftSentTo", { name: post!.user.name }));
      onClose();
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <Sheet open={!!post} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>{t("feed.sendGiftTo", { name: post?.user.name ?? "" })}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[18px] border border-border bg-border">
          {gifts?.map((g) => (
            <button
              key={g.id}
              disabled={giftMutation.isPending}
              onClick={() => giftMutation.mutate(g.id)}
              aria-label={`${t(`wallet.gifts.${g.key}`)} · ${g.coins}`}
              className="flex flex-col items-center gap-1.5 bg-card px-2 py-4 transition-colors hover:bg-muted active:bg-muted disabled:opacity-60"
            >
              <GiftGlyph giftKey={g.key} emoji={g.emoji} />
              <span className="font-numeric text-xs font-bold text-brand-gold">{g.coins}</span>
            </button>
          ))}
          {gifts &&
            Array.from({ length: (3 - (gifts.length % 3)) % 3 }).map((_, i) => (
              <div key={`pad-${i}`} aria-hidden className="bg-card" />
            ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
