import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Heart,
  MessageCircle,
  Share2,
  Gift,
  Music,
  Trophy,
  BadgeCheck,
  Volume2,
  Send,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCount } from "@/lib/mock-data";
import { translateServerError } from "@/lib/i18n";
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

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { data } = useQuery({ queryKey: ["feed"], queryFn: () => listFeed() });

  return (
    <AppShell>
      <TopBar transparent />
      <div className="relative -mt-14">
        <FeedSlider posts={data ?? []} />
      </div>
    </AppShell>
  );
}

function FeedSlider({ posts }: { posts: FeedPostDTO[] }) {
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [giftFor, setGiftFor] = useState<FeedPostDTO | null>(null);
  return (
    <div className="h-[calc(100dvh-80px)] snap-y snap-mandatory overflow-y-auto no-scrollbar">
      {posts.map((p) => (
        <FeedItem
          key={p.id}
          post={p}
          onOpenComments={() => setCommentsFor(p.id)}
          onOpenGift={() => setGiftFor(p)}
        />
      ))}
      <CommentsSheet postId={commentsFor} onClose={() => setCommentsFor(null)} />
      <GiftSheet post={giftFor} onClose={() => setGiftFor(null)} />
    </div>
  );
}

function FeedItem({
  post,
  onOpenComments,
  onOpenGift,
}: {
  post: FeedPostDTO;
  onOpenComments: () => void;
  onOpenGift: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const likeMutation = useMutation({
    mutationFn: () => toggleLike({ data: { postId: post.id } }),
    onMutate: async () => {
      queryClient.setQueryData<FeedPostDTO[]>(["feed"], (old) =>
        old?.map((p) =>
          p.id === post.id
            ? { ...p, likedByMe: !p.likedByMe, likes: p.likes + (p.likedByMe ? -1 : 1) }
            : p,
        ),
      );
    },
  });

  const followMutation = useMutation({
    mutationFn: () => toggleFollow({ data: { userId: post.user.id } }),
    onMutate: async () => {
      queryClient.setQueryData<FeedPostDTO[]>(["feed"], (old) =>
        old?.map((p) =>
          p.user.id === post.user.id ? { ...p, followingAuthor: !p.followingAuthor } : p,
        ),
      );
    },
  });

  const shareMutation = useMutation({
    mutationFn: () => sharePost({ data: { postId: post.id } }),
    onSuccess: async () => {
      queryClient.setQueryData<FeedPostDTO[]>(["feed"], (old) =>
        old?.map((p) => (p.id === post.id ? { ...p, shares: p.shares + 1 } : p)),
      );
      const url = `${window.location.origin}/?post=${post.id}`;
      if (navigator.share) {
        await navigator.share({ title: post.title, url }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(url);
        toast.success(t("common.linkCopied"));
      }
    },
  });

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

      <div className="absolute bottom-32 right-3 z-10 flex flex-col items-center gap-5">
        <div className="relative">
          <img
            src={post.user.avatar}
            alt=""
            className="h-12 w-12 rounded-full border-2 border-white/80"
          />
          <button
            onClick={() => followMutation.mutate()}
            className={`absolute -bottom-2 left-1/2 -translate-x-1/2 grid h-5 w-5 place-items-center rounded-full text-[12px] font-bold text-white ${
              post.followingAuthor ? "bg-secondary" : "gradient-neon glow-pink"
            }`}
          >
            {post.followingAuthor ? "✓" : "+"}
          </button>
        </div>
        <ActionButton
          onClick={() => likeMutation.mutate()}
          icon={
            <Heart className={`h-7 w-7 ${post.likedByMe ? "fill-primary text-primary" : ""}`} />
          }
          count={formatCount(post.likes)}
        />
        <ActionButton
          onClick={onOpenComments}
          icon={<MessageCircle className="h-7 w-7" />}
          count={formatCount(post.comments)}
        />
        <ActionButton
          onClick={onOpenGift}
          icon={<Gift className="h-7 w-7 text-accent" />}
          count={formatCount(post.gifts)}
        />
        <ActionButton
          onClick={() => shareMutation.mutate()}
          icon={<Share2 className="h-7 w-7" />}
          count={formatCount(post.shares)}
        />
        <button className="grid h-10 w-10 place-items-center rounded-full glass animate-spin-slow">
          <Music className="h-5 w-5 text-white" />
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 p-4 pb-6">
        <Link
          to="/profile/$handle"
          params={{ handle: post.user.handle }}
          className="flex items-center gap-2 text-white"
        >
          <span className="font-display text-base font-bold">{post.user.name}</span>
          {post.user.verified && <BadgeCheck className="h-4 w-4 text-accent" />}
          <span className="text-xs text-white/70">@{post.user.handle}</span>
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
      queryClient.setQueryData<FeedPostDTO[]>(["feed"], (old) =>
        old?.map((p) => (p.id === postId ? { ...p, comments: p.comments + 1 } : p)),
      );
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
                <p className="text-xs font-semibold">{c.user.name}</p>
                <p className="text-sm">{c.body}</p>
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
            className="flex-1 rounded-full bg-background/70 px-4 py-2 text-sm outline-none ring-1 ring-border"
          />
          <button
            type="submit"
            className="grid h-10 w-10 place-items-center rounded-full gradient-neon"
          >
            <Send className="h-4 w-4 text-white" />
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
      queryClient.setQueryData<FeedPostDTO[]>(["feed"], (old) =>
        old?.map((p) => (p.id === post!.id ? { ...p, gifts: p.gifts + 1 } : p)),
      );
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
        <div className="mt-3 grid grid-cols-3 gap-2">
          {gifts?.map((g) => (
            <button
              key={g.id}
              disabled={giftMutation.isPending}
              onClick={() => giftMutation.mutate(g.id)}
              className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card/60 p-3 hover:border-accent/50 disabled:opacity-60"
            >
              <span className="text-3xl">{g.emoji}</span>
              <span className="text-[11px] font-mono text-accent">{g.coins}</span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
