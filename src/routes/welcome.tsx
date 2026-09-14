import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Gift,
  Heart,
  MessageCircle,
  Music,
  Share2,
  Trophy,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { setLanguage } from "@/lib/i18n";
import { PostCoverBg } from "@/components/PostCoverBg";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCount } from "@/lib/mock-data";
import { listPublicFeed, type FeedPostDTO } from "@/functions/posts";

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
});

const LANGS = [
  { code: "en", label: "EN" },
  { code: "he", label: "עב" },
  { code: "ar", label: "عر" },
];

// The welcome screen for a signed-out visitor is the real feed itself — same posts a logged-in
// user sees, autoplaying, full screen. Any interaction that would actually change something
// (like, comment, follow, gift, share) opens the AuthGateSheet instead of doing it, same as
// browsing TikTok logged out.
function WelcomePage() {
  const { t, i18n } = useTranslation();
  const { data: posts } = useQuery({ queryKey: ["publicFeed"], queryFn: () => listPublicFeed() });
  const [gateOpen, setGateOpen] = useState(false);
  const openGate = () => setGateOpen(true);

  return (
    <div className="relative mx-auto h-dvh w-full max-w-[520px] overflow-hidden bg-black text-white">
      <header className="fixed left-1/2 top-0 z-30 flex w-full max-w-[520px] -translate-x-1/2 items-center justify-between bg-gradient-to-b from-black/70 via-black/25 to-transparent px-4 py-3">
        <span className="flex items-center gap-2">
          <img src="/brand/logo-mark.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-display text-xl font-bold text-brand-coral drop-shadow-md">
            Studio26
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <div className="hidden items-center gap-0.5 rounded-full border border-white/15 p-0.5 sm:flex">
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => setLanguage(l.code)}
                className={`rounded-full px-2 py-1 text-[11px] font-semibold transition-colors ${
                  i18n.language?.startsWith(l.code)
                    ? "bg-brand-coral/25 text-brand-coral"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <Link
            to="/login"
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-white/85 hover:text-white"
          >
            {t("landing.nav.login")}
          </Link>
          <Link
            to="/signup"
            className="rounded-full bg-brand-coral px-3.5 py-1.5 text-xs font-bold text-white shadow-pop-coral press-scale hover-lift"
          >
            {t("landing.nav.signup")}
          </Link>
        </div>
      </header>

      <PublicFeed posts={posts ?? []} onGate={openGate} />

      <AuthGateSheet open={gateOpen} onClose={() => setGateOpen(false)} />
    </div>
  );
}

function PublicFeed({ posts, onGate }: { posts: FeedPostDTO[]; onGate: () => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Same "whichever section crosses the intersection threshold is playing" approach as the real
  // feed (src/routes/index.tsx) — see the comment there for why activeId isn't a dependency here.
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

  if (posts.length === 0) {
    return <div className="h-dvh w-full animate-pulse bg-white/5" />;
  }

  return (
    <div
      ref={containerRef}
      onClick={() => {
        if (!hasInteracted) {
          setHasInteracted(true);
          setMuted(false);
        }
      }}
      className="h-dvh snap-y snap-mandatory overflow-y-auto no-scrollbar"
    >
      {posts.map((p, i) => {
        const activeIndex = posts.findIndex((x) => x.id === activeId);
        const preload =
          p.id === activeId ? "auto" : Math.abs(i - activeIndex) === 1 ? "metadata" : "none";
        return (
          <PublicFeedItem
            key={p.id}
            post={p}
            active={p.id === activeId}
            preload={preload}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            showSoundHint={!hasInteracted && p.id === activeId}
            onGate={onGate}
          />
        );
      })}
    </div>
  );
}

function PublicFeedItem({
  post,
  active,
  preload,
  muted,
  onToggleMute,
  showSoundHint,
  onGate,
}: {
  post: FeedPostDTO;
  active: boolean;
  preload: "auto" | "metadata" | "none";
  muted: boolean;
  onToggleMute: () => void;
  showSoundHint: boolean;
  onGate: () => void;
}) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLMediaElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

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

  const typeLabel: Record<string, string> = {
    cover: t("feed.cover"),
    original: t("feed.original"),
    djset: t("feed.djset"),
    teaser: t("feed.teaser"),
    competition: t("common.live"),
  };

  // Double-tap still bursts a heart, same gesture as the real feed — it just opens the sign-up
  // gate instead of actually recording a like.
  const lastTapRef = useRef(0);
  const [burstKey, setBurstKey] = useState(0);
  const [showBurst, setShowBurst] = useState(false);
  const handleCoverTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setBurstKey((k) => k + 1);
      setShowBurst(true);
      onGate();
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
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/85" />

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
        className="absolute left-4 top-16 z-10 flex items-center gap-2"
      >
        <span className="rounded-full glass px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90">
          {typeLabel[post.type] ?? post.type}
        </span>
      </motion.div>

      <motion.div
        initial={false}
        animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: active ? 0.05 : 0 }}
        className="absolute bottom-32 right-3 z-10 flex flex-col items-center gap-5"
      >
        <button onClick={onGate} className="relative">
          <img
            src={post.user.avatar}
            alt=""
            className="h-12 w-12 rounded-full border-2 border-white/80"
          />
          <span className="absolute -bottom-2 left-1/2 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full bg-brand-coral text-[12px] font-bold text-white shadow-pop-coral">
            +
          </span>
        </button>
        <ActionButton
          onClick={onGate}
          icon={<Heart className="h-7 w-7" />}
          count={formatCount(post.likes)}
        />
        <ActionButton
          onClick={onGate}
          icon={<MessageCircle className="h-7 w-7" />}
          count={formatCount(post.comments)}
        />
        <ActionButton
          onClick={onGate}
          icon={<Gift className="h-7 w-7 text-accent" />}
          count={formatCount(post.gifts)}
        />
        <ActionButton
          onClick={onGate}
          icon={<Share2 className="h-7 w-7" />}
          count={formatCount(post.shares)}
        />
        <button
          className={`grid h-10 w-10 place-items-center rounded-full glass ${isPlaying ? "animate-spin-fast" : ""}`}
        >
          <Music className="h-5 w-5 text-white" />
        </button>
      </motion.div>

      <motion.div
        initial={false}
        animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: active ? 0.1 : 0 }}
        className="absolute inset-x-0 bottom-0 z-10 p-4 pb-8"
      >
        <button onClick={onGate} className="flex items-center gap-2 text-white">
          <span className="font-display text-base font-bold">{post.user.name}</span>
          {post.user.verified && <BadgeCheck className="h-4 w-4 text-accent" />}
          <span className="text-xs text-white/70">@{post.user.handle}</span>
        </button>
        <p className="mt-1 max-w-[85%] text-sm text-white/90">{post.title}</p>
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
          <span className="line-clamp-1">{post.song}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={onGate}
            className={
              post.type === "competition"
                ? "rounded-full bg-brand-coral px-4 py-1.5 text-xs font-bold text-white shadow-pop-coral press-scale"
                : "rounded-full glass border border-white/20 px-4 py-1.5 text-xs font-bold text-white"
            }
          >
            <Trophy className="mr-1 inline h-3.5 w-3.5" />
            {t("feed.competition")}
          </button>
        </div>
      </motion.div>
    </section>
  );
}

function ActionButton({
  icon,
  count,
  onClick,
}: {
  icon: React.ReactNode;
  count?: string;
  onClick?: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.85 }}
      onClick={onClick}
      className="flex flex-col items-center gap-1 text-white"
    >
      <div className="grid h-11 w-11 place-items-center rounded-full glass">{icon}</div>
      {count && <span className="text-[11px] font-semibold">{count}</span>}
    </motion.button>
  );
}

function AuthGateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl border-white/10 bg-zinc-950 text-white">
        <SheetHeader>
          <SheetTitle className="text-white">{t("landing.gate.title")}</SheetTitle>
        </SheetHeader>
        <p className="mt-1 text-sm text-white/60">{t("landing.gate.subtitle")}</p>
        <div className="mt-5 flex flex-col gap-2 pb-2">
          <Link
            to="/signup"
            className="rounded-full bg-brand-coral py-3 text-center text-sm font-bold text-white shadow-pop-coral press-scale hover-lift"
          >
            {t("landing.hero.ctaPrimary")}
          </Link>
          <Link
            to="/login"
            className="rounded-full border border-white/20 py-3 text-center text-sm font-semibold text-white/90"
          >
            {t("landing.hero.ctaSecondary")}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
