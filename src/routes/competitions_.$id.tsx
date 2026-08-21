import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Trophy, Users, Award, ArrowLeft, ThumbsUp, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCompetition, joinCompetition, voteEntry } from "@/functions/competitions";
import { listMyPublishedPosts } from "@/functions/posts";
import { useCurrentUser } from "@/hooks/use-current-user";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/competitions_/$id")({
  component: CompetitionDetailPage,
});

const staggerClasses = ["stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6"];

function CompetitionDetailPage() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const { data: me } = useCurrentUser();
  const queryClient = useQueryClient();
  const [joinOpen, setJoinOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["competition", id],
    queryFn: () => getCompetition({ data: { id } }),
  });
  const { data: myPosts } = useQuery({
    queryKey: ["myPublishedPosts"],
    queryFn: () => listMyPublishedPosts(),
    enabled: joinOpen,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["competition", id] });

  const joinMutation = useMutation({
    mutationFn: (postId: string) => joinCompetition({ data: { competitionId: id, postId } }),
    onSuccess: () => {
      invalidate();
      setJoinOpen(false);
      toast.success(t("comp.entered"));
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const voteMutation = useMutation({
    mutationFn: (entryId: string) => voteEntry({ data: { entryId } }),
    onSuccess: () => {
      invalidate();
      toast.success(t("comp.voteCast"));
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  if (!data) {
    return (
      <AppShell>
        <TopBar />
      </AppShell>
    );
  }

  const { competition, entries, myVoteEntryId } = data;
  const alreadyEntered = entries.some((e) => e.user.id === me?.id);

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <Link
          to="/competitions"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t("comp.title")}
        </Link>

        <article className="relative h-48 overflow-hidden rounded-3xl shadow-pop-lg">
          <PostCoverBg hue={competition.hue} seed={competition.coverSeed} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
              {t(`comp.${competition.stage}`)}
            </span>
            <h1 className="mt-2 font-display text-2xl font-bold text-white">{competition.title}</h1>
            <div className="mt-1 flex items-center gap-3 text-xs text-white/80">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {t("comp.entriesCount", { n: entries.length })}
              </span>
              <span className="flex items-center gap-1">
                <Award className="h-3.5 w-3.5 text-accent" /> {competition.prize}
              </span>
            </div>
          </div>
        </article>

        <button
          onClick={() => setJoinOpen(true)}
          disabled={alreadyEntered}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-brand-coral py-2.5 text-sm font-bold text-white shadow-pop-coral press-scale disabled:opacity-50"
        >
          <Trophy className="h-4 w-4" />{" "}
          {alreadyEntered ? t("comp.alreadyEntered") : t("comp.join")}
        </button>

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("comp.entriesHeading")}
        </h2>
        {entries.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">{t("comp.noEntriesYet")}</p>
        )}
        <div className="mt-2 space-y-2">
          {entries.map((e, i) => (
            <div
              key={e.id}
              className={`flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-pop animate-fade-up ${staggerClasses[i % 6]}`}
            >
              <img src={e.user.avatarUrl} className="h-10 w-10 rounded-full" alt="" />
              <div className="flex-1">
                <p className="text-sm font-semibold">{e.post.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {e.user.name} · {t("comp.votesCount", { n: e.votesCount })}
                </p>
              </div>
              <AnimatePresence mode="wait" initial={false}>
                {myVoteEntryId === e.id ? (
                  <motion.span
                    key="voted"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    className="flex items-center gap-1 text-xs font-semibold text-accent"
                  >
                    <CheckCircle2 className="h-4 w-4" /> {t("comp.voted")}
                  </motion.span>
                ) : (
                  <motion.button
                    key="vote"
                    whileTap={{ scale: 0.88 }}
                    onClick={() => voteMutation.mutate(e.id)}
                    disabled={!!myVoteEntryId || e.user.id === me?.id || voteMutation.isPending}
                    className="flex items-center gap-1 rounded-full border border-primary/60 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-40"
                  >
                    <ThumbsUp className="h-3.5 w-3.5" /> {t("common.vote")}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("comp.pickTrack")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {myPosts?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("comp.noPublishedTracks")}{" "}
                <Link to="/upload" search={{}} className="text-accent underline">
                  {t("comp.uploadOne")}
                </Link>{" "}
                {t("comp.first")}
              </p>
            )}
            {myPosts?.map((p) => (
              <button
                key={p.id}
                disabled={joinMutation.isPending}
                onClick={() => joinMutation.mutate(p.id)}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-start press-scale hover:border-primary/50"
              >
                <div className="relative h-10 w-10 overflow-hidden rounded-lg">
                  <PostCoverBg hue={p.hue} seed={p.id} />
                </div>
                <span className="flex-1 text-sm font-semibold">{p.title}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
