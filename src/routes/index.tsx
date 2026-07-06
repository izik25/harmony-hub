import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Heart, MessageCircle, Share2, Gift, Music, Trophy, BadgeCheck, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { feedPosts, formatCount, type FeedPost } from "@/lib/mock-data";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <AppShell>
      <TopBar transparent />
      <div className="relative -mt-14">
        <FeedSlider />
      </div>
    </AppShell>
  );
}

function FeedSlider() {
  return (
    <div className="h-[calc(100dvh-80px)] snap-y snap-mandatory overflow-y-auto no-scrollbar">
      {feedPosts.map((p) => (
        <FeedItem key={p.id} post={p} />
      ))}
    </div>
  );
}

function FeedItem({ post }: { post: FeedPost }) {
  const { t } = useTranslation();
  const [liked, setLiked] = useState(false);
  const [following, setFollowing] = useState(false);

  const typeLabel: Record<string, string> = {
    cover: t("feed.cover"),
    original: t("feed.original"),
    djset: t("feed.djset"),
    teaser: t("feed.teaser"),
    competition: t("common.live"),
  };

  return (
    <section className="relative h-[calc(100dvh-80px)] snap-start overflow-hidden">
      <PostCoverBg hue={post.hue} seed={post.id} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/80" />

      {/* type chip */}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <span className="rounded-full glass px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90">
          {typeLabel[post.type] ?? post.type}
        </span>
        {post.type === "competition" && (
          <span className="rounded-full bg-primary px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-primary-foreground animate-pulse-glow">
            {t("common.live")}
          </span>
        )}
      </div>

      {/* side actions */}
      <div className="absolute bottom-32 right-3 z-10 flex flex-col items-center gap-5">
        <div className="relative">
          <img src={post.user.avatar} alt="" className="h-12 w-12 rounded-full border-2 border-white/80" />
          <button
            onClick={() => setFollowing((v) => !v)}
            className={`absolute -bottom-2 left-1/2 -translate-x-1/2 grid h-5 w-5 place-items-center rounded-full text-[12px] font-bold text-white ${
              following ? "bg-secondary" : "gradient-neon glow-pink"
            }`}
          >
            {following ? "✓" : "+"}
          </button>
        </div>
        <ActionButton onClick={() => setLiked((v) => !v)} icon={<Heart className={`h-7 w-7 ${liked ? "fill-primary text-primary" : ""}`} />} count={formatCount(post.likes + (liked ? 1 : 0))} />
        <ActionButton icon={<MessageCircle className="h-7 w-7" />} count={formatCount(post.comments)} />
        <ActionButton icon={<Gift className="h-7 w-7 text-accent" />} count={formatCount(post.gifts)} />
        <ActionButton icon={<Share2 className="h-7 w-7" />} count={formatCount(post.shares)} />
        <button className="grid h-10 w-10 place-items-center rounded-full glass animate-spin-slow">
          <Music className="h-5 w-5 text-white" />
        </button>
      </div>

      {/* bottom overlay */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-4 pb-6">
        <Link to="/profile" className="flex items-center gap-2 text-white">
          <span className="font-display text-base font-bold">{post.user.name}</span>
          {post.user.verified && <BadgeCheck className="h-4 w-4 text-accent" />}
          <span className="text-xs text-white/70">{post.user.handle}</span>
        </Link>
        <p className="mt-1 max-w-[85%] text-sm text-white/90">{post.title}</p>
        <div className="mt-2 flex items-center gap-2 text-xs text-white/80">
          <Volume2 className="h-3.5 w-3.5" />
          <span className="line-clamp-1">{post.song}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className={
              post.type === "competition"
                ? "rounded-full gradient-neon px-4 py-1.5 text-xs font-bold text-white glow-pink"
                : "rounded-full glass border border-white/20 px-4 py-1.5 text-xs font-bold text-white"
            }
          >
            <Trophy className="mr-1 inline h-3.5 w-3.5" />
            {t("feed.competition")}
          </button>
          <CreditsPop credits={post.credits} />
        </div>
      </div>
    </section>
  );
}

function ActionButton({ icon, count, onClick }: { icon: React.ReactNode; count?: string; onClick?: () => void }) {
  return (
    <motion.button whileTap={{ scale: 0.85 }} onClick={onClick} className="flex flex-col items-center gap-1 text-white">
      <div className="grid h-11 w-11 place-items-center rounded-full glass">{icon}</div>
      {count && <span className="text-[11px] font-semibold">{count}</span>}
    </motion.button>
  );
}

function CreditsPop({ credits }: { credits: FeedPost["credits"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="rounded-full glass border border-white/20 px-3 py-1.5 text-[11px] font-semibold text-white/90">
        Credits
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-full mb-2 w-56 rounded-2xl glass border border-border p-3 text-[11px]"
          >
            <Row k="Performer" v={credits.performer} />
            <Row k="Writer" v={credits.writer} />
            <Row k="Composer" v={credits.composer} />
            <Row k="Producer" v={credits.producer} />
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
