import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Search, Send, Building2, BadgeCheck, Bookmark, BookmarkCheck } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
      <div className="px-4 pt-3 pb-6">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-accent" />
          <h1 className="font-display text-2xl font-bold">{t("label.title")}</h1>
        </div>

        <label className="mt-4 flex items-center gap-2 rounded-full bg-muted/60 px-4 py-3 ring-1 ring-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("label.find")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <p className="mt-2 text-[11px] text-muted-foreground">{t("label.filter")}</p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("label.talentHeading")}
        </h2>
        <ul className="mt-2 space-y-2">
          {talent?.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("label.noMatchingArtists")}</p>
          )}
          {talent?.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 p-3"
            >
              <Link to="/profile/$handle" params={{ handle: a.handle }}>
                <img src={a.avatarUrl} className="h-11 w-11 rounded-full" alt="" />
              </Link>
              <div className="flex-1">
                <Link
                  to="/profile/$handle"
                  params={{ handle: a.handle }}
                  className="flex items-center gap-1 text-sm font-semibold"
                >
                  {a.name} {a.verified && <BadgeCheck className="h-4 w-4 text-accent" />}
                </Link>
                <p className="text-[11px] text-muted-foreground">
                  {a.voiceType || "—"} · {a.country || "—"}
                </p>
              </div>
              <button
                onClick={() => contactMutation.mutate(a.id)}
                disabled={contactMutation.isPending}
                className="flex items-center gap-1 rounded-full gradient-neon px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" /> {t("label.contact")}
              </button>
            </li>
          ))}
        </ul>

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("label.auditionsHeading")}
        </h2>
        <ul className="mt-2 space-y-2">
          {auditions?.map((a) => (
            <li key={a.id} className="rounded-2xl border border-border bg-card/60 p-3">
              <p className="text-sm font-semibold">{a.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {a.label.name} · {a.description}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => applyMutation.mutate(a.id)}
                  disabled={a.applied || applyMutation.isPending}
                  className="rounded-full border border-primary/50 px-3 py-1 text-xs font-semibold text-primary disabled:opacity-50"
                >
                  {a.applied ? t("label.applied") : t("label.apply")}
                </button>
                <button
                  onClick={() => saveMutation.mutate(a.id)}
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs"
                >
                  {a.saved ? (
                    <BookmarkCheck className="h-3.5 w-3.5" />
                  ) : (
                    <Bookmark className="h-3.5 w-3.5" />
                  )}{" "}
                  {t("label.save")}
                </button>
              </div>
            </li>
          ))}
        </ul>

        <button
          onClick={() => setPostOpen(true)}
          className="mt-6 w-full rounded-full gradient-neon py-2.5 text-sm font-bold text-white glow-pink"
        >
          {t("label.audition")}
        </button>
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
            <button
              onClick={() => postMutation.mutate()}
              disabled={postMutation.isPending}
              className="w-full rounded-full gradient-neon py-2.5 text-sm font-bold text-white glow-pink disabled:opacity-60"
            >
              {t("common.publish")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <style>{`.input { width: 100%; border-radius: 12px; background: var(--color-input); padding: 10px 12px; font-size: 14px; outline: none; border: 1px solid var(--color-border); }`}</style>
    </AppShell>
  );
}
