import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, MessageSquare, Trophy, Share2, Trash2, Loader2, Globe, Lock } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PostCoverBg } from "@/components/PostCoverBg";
import { updatePost, deletePost, listComments, deleteComment, sharePost } from "@/functions/posts";
import type { listUserPosts } from "@/functions/profile";
import { listCompetitions, joinCompetition } from "@/functions/competitions";
import { translateServerError } from "@/lib/i18n";
import { shareContent } from "@/lib/share";

type PostRow = Awaited<ReturnType<typeof listUserPosts>>[number];
type SubView = "edit" | "comments" | "competition" | "deleteConfirm" | null;

const categories = ["Pop", "Hip-Hop", "Electronic", "Rock", "R&B"];

/**
 * Every management action a post owner has on one of their own posts, opened from a tile in
 * their profile grid: edit its details, moderate its comments, enter it into a competition,
 * share it, or delete it — the same set of actions TikTok/IG give you on your own posts. Doesn't
 * touch the audio itself (that's Studio's job, via a draftId) — this is metadata + lifecycle only.
 */
export function PostActionsSheet({
  post,
  handle,
  onClose,
}: {
  post: PostRow | null;
  handle: string;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!post} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        {post && <PostActionsMenu post={post} handle={handle} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function PostActionsMenu({
  post,
  handle,
  onClose,
}: {
  post: PostRow;
  handle: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [view, setView] = useState<SubView>(null);

  const invalidatePost = () => {
    queryClient.invalidateQueries({ queryKey: ["userPosts", handle] });
    queryClient.invalidateQueries({ queryKey: ["profile", handle] });
  };

  const shareMutation = useMutation({
    mutationFn: async () => {
      const url = `${window.location.origin}/?post=${post.id}`;
      const result = await shareContent({ title: post.title, url });
      if (result === "cancelled") return result;
      await sharePost({ data: { postId: post.id } });
      return result;
    },
    onSuccess: (result) => {
      if (result === "copied") toast.success(t("common.linkCopied"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePost({ data: { id: post.id } }),
    onSuccess: () => {
      invalidatePost();
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      toast.success(t("profile.postActions.deletedToast"));
      onClose();
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-3">
          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg">
            <PostCoverBg hue={post.hue} seed={post.id} imageUrl={post.coverUrl} />
          </span>
          <span className="line-clamp-1 text-start text-base">
            {post.title || t("profile.postActions.title")}
          </span>
        </SheetTitle>
      </SheetHeader>

      <div className="mt-3 space-y-1">
        <MenuButton
          icon={Pencil}
          label={t("profile.postActions.edit")}
          onClick={() => setView("edit")}
        />
        <MenuButton
          icon={MessageSquare}
          label={t("profile.postActions.comments")}
          onClick={() => setView("comments")}
        />
        <MenuButton
          icon={Trophy}
          label={t("profile.postActions.sendToCompetition")}
          onClick={() => setView("competition")}
        />
        <MenuButton
          icon={shareMutation.isPending ? Loader2 : Share2}
          label={t("common.share")}
          onClick={() => shareMutation.mutate()}
          spin={shareMutation.isPending}
        />
        <MenuButton
          icon={Trash2}
          label={t("profile.postActions.delete")}
          onClick={() => setView("deleteConfirm")}
          destructive
        />
      </div>

      <EditPostDialog
        open={view === "edit"}
        onOpenChange={(v) => setView(v ? "edit" : null)}
        post={post}
        onSaved={() => {
          invalidatePost();
          queryClient.invalidateQueries({ queryKey: ["feed"] });
          toast.success(t("profile.postActions.updatedToast"));
          onClose();
        }}
      />

      <CommentsManageDialog
        open={view === "comments"}
        onOpenChange={(v) => setView(v ? "comments" : null)}
        postId={post.id}
      />

      <CompetitionPickerDialog
        open={view === "competition"}
        onOpenChange={(v) => setView(v ? "competition" : null)}
        postId={post.id}
        onEntered={onClose}
      />

      <Dialog
        open={view === "deleteConfirm"}
        onOpenChange={(v) => setView(v ? "deleteConfirm" : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("profile.postActions.deleteConfirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("profile.postActions.deleteConfirmBody")}
          </p>
          <DialogFooter>
            <button
              onClick={() => setView(null)}
              className="rounded-full border border-border px-4 py-2.5 text-sm font-semibold press-scale"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="flex items-center justify-center gap-2 rounded-full bg-destructive px-4 py-2.5 text-sm font-bold text-destructive-foreground press-scale disabled:opacity-60"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("profile.postActions.delete")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
  destructive,
  spin,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start text-sm font-semibold press-scale ${
        destructive ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted"
      }`}
    >
      <Icon className={`h-4.5 w-4.5 ${spin ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}

function EditPostDialog({
  open,
  onOpenChange,
  post,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: PostRow;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(post.title);
  const [category, setCategory] = useState(post.category || categories[0]);
  const [tags, setTags] = useState(post.tags.join(" "));
  const [performer, setPerformer] = useState(post.credits.performer);
  const [writer, setWriter] = useState(post.credits.writer);
  const [composer, setComposer] = useState(post.credits.composer);
  const [producer, setProducer] = useState(post.credits.producer);
  const [visibility, setVisibility] = useState<"public" | "private">(
    post.visibility === "private" ? "private" : "public",
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      updatePost({
        data: {
          id: post.id,
          title,
          songTitle: title,
          category,
          tags: tags.split(/\s+/).filter(Boolean),
          credits: { performer, writer, composer, producer },
          visibility,
        },
      }),
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("profile.postActions.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("upload.titlePlaceholder")}
            className="input"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input"
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("upload.tagsPlaceholder")}
              className="input"
            />
          </div>
          <fieldset className="rounded-2xl border border-border bg-card/40 p-3">
            <legend className="px-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("upload.credits")}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={performer}
                onChange={(e) => setPerformer(e.target.value)}
                placeholder={t("upload.performer")}
                className="input"
              />
              <input
                value={writer}
                onChange={(e) => setWriter(e.target.value)}
                placeholder={t("upload.writer")}
                className="input"
              />
              <input
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder={t("upload.composer")}
                className="input"
              />
              <input
                value={producer}
                onChange={(e) => setProducer(e.target.value)}
                placeholder={t("upload.producer")}
                className="input"
              />
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setVisibility("public")}
              className={`press-scale flex items-center justify-center gap-2 rounded-2xl border p-3 text-sm font-semibold transition-colors ${visibility === "public" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/60"}`}
            >
              <Globe className="h-4 w-4" /> {t("upload.public")}
            </button>
            <button
              onClick={() => setVisibility("private")}
              className={`press-scale flex items-center justify-center gap-2 rounded-2xl border p-3 text-sm font-semibold transition-colors ${visibility === "private" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/60"}`}
            >
              <Lock className="h-4 w-4" /> {t("upload.private")}
            </button>
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-coral py-2.5 text-sm font-bold text-white shadow-pop-coral press-scale disabled:opacity-60"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("common.save")}
          </button>
        </DialogFooter>
        <style>{`.input { width: 100%; border-radius: 12px; background: var(--color-input); padding: 10px 12px; font-size: 14px; outline: none; border: 1px solid var(--color-border); }`}</style>
      </DialogContent>
    </Dialog>
  );
}

function CommentsManageDialog({
  open,
  onOpenChange,
  postId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: comments } = useQuery({
    queryKey: ["comments", postId],
    queryFn: () => listComments({ data: { postId } }),
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteComment({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", postId] });
      toast.success(t("profile.postActions.commentDeletedToast"));
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("profile.postActions.comments")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {comments?.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("feed.noComments")}</p>
          )}
          {comments?.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <img src={c.user.avatar} className="h-8 w-8 shrink-0 rounded-full" alt="" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{c.user.name}</p>
                <p className="break-words text-sm">{c.body}</p>
              </div>
              <button
                onClick={() => deleteMutation.mutate(c.id)}
                disabled={deleteMutation.isPending}
                className="shrink-0 p-1 text-muted-foreground hover:text-destructive disabled:opacity-40"
                aria-label={t("profile.postActions.delete")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompetitionPickerDialog({
  open,
  onOpenChange,
  postId,
  onEntered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string;
  onEntered: () => void;
}) {
  const { t } = useTranslation();
  const { data: activeCompetitions } = useQuery({
    queryKey: ["competitions", "active"],
    queryFn: () => listCompetitions({ data: { status: "active" } }),
    enabled: open,
  });

  const joinMutation = useMutation({
    mutationFn: (competitionId: string) => joinCompetition({ data: { competitionId, postId } }),
    onSuccess: () => {
      toast.success(t("profile.postActions.enteredToast"));
      onEntered();
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("profile.postActions.pickCompetition")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {activeCompetitions?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("profile.postActions.noActiveCompetitions")}
            </p>
          )}
          {activeCompetitions?.map((c) => (
            <button
              key={c.id}
              disabled={joinMutation.isPending}
              onClick={() => joinMutation.mutate(c.id)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-start press-scale hover:border-primary/50 disabled:opacity-60"
            >
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                <PostCoverBg hue={c.hue} seed={c.coverSeed} />
              </div>
              <span className="flex-1 text-sm font-semibold">{c.title}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
