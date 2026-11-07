import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Search, Send, Building2, BadgeCheck, Bookmark, BookmarkCheck } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  listTalent,
  listAuditions,
  postAudition,
  applyToAudition,
  toggleSaveAudition,
} from "@/functions/label";
import { getOrCreateConversation } from "@/functions/messages";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/label-hub")({
  component: LabelPage,
});

function LabelPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [postOpen, setPostOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const { data: talent } = useQuery({
    queryKey: ["talent", query],
    queryFn: () => listTalent({ data: { query } }),
  });
  const { data: auditions } = useQuery({ queryKey: ["auditions"], queryFn: () => listAuditions() });

  const contactMutation = useMutation({
    mutationFn: (userId: string) =>
      getOrCreateConversation({
        data: { otherUserId: userId, initialMessage: t("messages.contactTemplate") },
      }),
    onSuccess: (conversation) =>
      navigate({ to: "/messages/$conversationId", params: { conversationId: conversation.id } }),
  });

  const applyMutation = useMutation({
    mutationFn: (auditionId: string) => applyToAudition({ data: { auditionId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auditions"] });
      toast.success(t("label.appliedToast"));
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const saveMutation = useMutation({
    mutationFn: (auditionId: string) => toggleSaveAudition({ data: { auditionId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auditions"] }),
  });

  const postMutation = useMutation({
    mutationFn: () => postAudition({ data: { title: newTitle, description: newDescription } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auditions"] });
      setPostOpen(false);
      setNewTitle("");
      setNewDescription("");
      toast.success(t("label.auditionPosted"));
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pb-8 pt-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="page-title">{t("label.title")}</h1>
          <Building2 className="h-6 w-6 shrink-0 text-brand-gold" aria-hidden />
        </div>

        <label className="mt-5 flex h-12 items-center gap-2 rounded-xl bg-muted/60 px-4 ring-1 ring-border focus-within:ring-ring">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("label.find")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <p className="mt-2 text-xs text-muted-foreground">{t("label.filter")}</p>

        <h2 className="section-label mt-8">{t("label.talentHeading")}</h2>
        {talent?.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("label.noMatchingArtists")}</p>
        ) : (
          <ul className="list-group mt-3">
            {talent?.map((a, i) => (
              <li
                key={a.id}
                className={`flex items-center gap-3 px-4 py-3 animate-fade-up stagger-${(i % 6) + 1}`}
              >
                <Link to="/profile/$handle" params={{ handle: a.handle }} className="shrink-0">
                  <img src={a.avatarUrl} className="h-11 w-11 rounded-full" alt="" />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    to="/profile/$handle"
                    params={{ handle: a.handle }}
                    className="flex items-center gap-1 text-sm font-semibold hover:underline"
                  >
                    <span className="truncate">{a.name}</span>
                    {a.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-accent" />}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {a.voiceType || "—"} · {a.country || "—"}
                  </p>
                </div>
                <button
                  onClick={() => contactMutation.mutate(a.id)}
                  disabled={contactMutation.isPending}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--hairline-strong)] px-3 text-xs font-semibold transition-colors hover:bg-muted/60 disabled:opacity-60 press-scale"
                >
                  <Send className="h-3.5 w-3.5 text-brand-teal rtl:-scale-x-100" />
                  {t("label.contact")}
                </button>
              </li>
            ))}
          </ul>
        )}

        <h2 className="section-label mt-8">{t("label.auditionsHeading")}</h2>
        <ul className="list-group mt-3">
          {auditions?.map((a, i) => (
            <li key={a.id} className={`px-4 py-4 animate-fade-up stagger-${(i % 6) + 1}`}>
              <p className="bidi-auto font-semibold">{a.title}</p>
              <p className="bidi-auto mt-1 text-sm text-muted-foreground">
                <span className="text-foreground/80">{a.label.name}</span> · {a.description}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => applyMutation.mutate(a.id)}
                  disabled={a.applied || applyMutation.isPending}
                  className={`h-9 rounded-lg px-4 text-xs font-bold transition-colors press-scale disabled:cursor-default ${
                    a.applied
                      ? "bg-muted text-muted-foreground"
                      : "bg-brand-coral/15 text-brand-coral hover:bg-brand-coral/25"
                  }`}
                >
                  {a.applied ? t("label.applied") : t("label.apply")}
                </button>
                <button
                  onClick={() => saveMutation.mutate(a.id)}
                  aria-pressed={a.saved}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold transition-colors hover:bg-muted/60 press-scale"
                >
                  {a.saved ? (
                    <BookmarkCheck className="h-3.5 w-3.5 text-brand-gold" />
                  ) : (
                    <Bookmark className="h-3.5 w-3.5" />
                  )}
                  {t("label.save")}
                </button>
              </div>
            </li>
          ))}
        </ul>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setPostOpen(true)}
          className="mt-6 h-12 w-full rounded-xl bg-brand-coral text-sm font-bold text-white shadow-pop-coral transition-[filter] hover:brightness-110"
        >
          {t("label.audition")}
        </motion.button>
      </div>

      <Dialog open={postOpen} onOpenChange={setPostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("label.audition")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t("label.titlePlaceholder")}
              className="input"
            />
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={3}
              placeholder={t("label.descPlaceholder")}
              className="input"
            />
            <motion.button
              whileTap={{ scale: 0.96 }}
              whileHover={{ scale: 1.01 }}
              transition={{ type: "spring", stiffness: 420, damping: 24 }}
              onClick={() => postMutation.mutate()}
              disabled={postMutation.isPending}
              className="h-12 w-full rounded-xl bg-brand-coral text-sm font-bold text-white shadow-pop-coral disabled:opacity-60"
            >
              {t("common.publish")}
            </motion.button>
          </div>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}
