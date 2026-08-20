import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Upload,
  Music,
  Mic,
  Radio,
  Play,
  Pause,
  Globe,
  Lock,
  CheckCircle2,
  Share2,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { PublishEverywhereModal } from "@/components/PublishEverywhereModal";
import { getDraft, publishPost } from "@/functions/posts";
import { generateCoverImage } from "@/functions/cover-image";
import { smartUploadMedia } from "@/lib/blob-upload";
import { translateServerError } from "@/lib/i18n";

interface UploadSearch {
  draftId?: string;
  forCompetition?: number;
  justPublishedId?: string;
  platformConnected?: string;
  platformError?: string;
}

export const Route = createFileRoute("/upload")({
  validateSearch: (search: Record<string, unknown>): UploadSearch => ({
    draftId: typeof search.draftId === "string" ? search.draftId : undefined,
    forCompetition: typeof search.forCompetition === "number" ? search.forCompetition : undefined,
    justPublishedId:
      typeof search.justPublishedId === "string" ? search.justPublishedId : undefined,
    platformConnected:
      typeof search.platformConnected === "string" ? search.platformConnected : undefined,
    platformError: typeof search.platformError === "string" ? search.platformError : undefined,
  }),
  component: UploadPage,
});

const types = [
  { key: "cover", icon: Mic, labelKey: "feed.cover" },
  { key: "original", icon: Music, labelKey: "feed.original" },
  { key: "djset", icon: Radio, labelKey: "feed.djset" },
  { key: "teaser", icon: Play, labelKey: "feed.teaser" },
] as const;

function UploadPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const draftId = search.draftId;
  const justPublishedId = search.justPublishedId;

  const { data: draft } = useQuery({
    queryKey: ["draft", draftId],
    queryFn: () => getDraft({ data: { id: draftId! } }),
    enabled: !!draftId,
  });

  const { data: publishedPost } = useQuery({
    queryKey: ["draft", justPublishedId],
    queryFn: () => getDraft({ data: { id: justPublishedId! } }),
    enabled: !!justPublishedId,
  });

  // Landing back here after an OAuth connect round-trip (see server.ts's /api/connect/* handlers)
  // — surface the result once, then strip these two params so a refresh doesn't re-toast.
  useEffect(() => {
    if (!search.platformConnected && !search.platformError) return;
    if (search.platformConnected) {
      toast.success(t("publishEverywhere.connectSuccess", { platform: search.platformConnected }));
    }
    if (search.platformError) {
      const [platform] = search.platformError.split(":");
      toast.error(t("publishEverywhere.connectFailed", { platform }));
    }
    queryClient.invalidateQueries({ queryKey: ["platformStatus"] });
    navigate({
      to: "/upload",
      search: { justPublishedId },
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.platformConnected, search.platformError]);

  const [type, setType] = useState<(typeof types)[number]["key"] | "competition">(
    search.forCompetition ? "competition" : "cover",
  );
  const [visibility, setV] = useState<"public" | "private">("public");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Pop");
  const [tags, setTags] = useState("");
  const [performer, setPerformer] = useState("");
  const [writer, setWriter] = useState("");
  const [composer, setComposer] = useState("");
  const [producer, setProducer] = useState("");
  const [pickedFile, setPickedFile] = useState<{ url: string; name: string } | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const { url } = await smartUploadMedia(file, file.name);
      return { url, name: file.name };
    },
    onSuccess: (result) => setPickedFile(result),
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const audioUrl = draftId ? draft?.audioUrl : pickedFile?.url;
  const coverSubject = title.trim() || draft?.title || draft?.songTitle || "";

  const coverMutation = useMutation({
    mutationFn: () => generateCoverImage({ data: { songTitle: coverSubject, category } }),
    onSuccess: (result) => setCoverUrl(result.url),
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const togglePreview = () => {
    if (!audioUrl) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  const publishMutation = useMutation({
    mutationFn: () =>
      publishPost({
        data: {
          draftId,
          audioUrl: draftId ? undefined : pickedFile?.url,
          coverUrl: coverUrl ?? undefined,
          type,
          title: title.trim() || t("upload.untitled"),
          songTitle: title.trim(),
          category,
          tags: tags.split(/\s+/).filter(Boolean),
          credits: { performer, writer, composer, producer },
          visibility,
        },
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      queryClient.invalidateQueries({ queryKey: ["userPosts"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["myDrafts"] });
      toast.success(t("upload.publishedToast"));
      // Route through justPublishedId (instead of straight to "/") so the "publish everywhere"
      // modal below has a post to work with — it opens automatically whenever this is set.
      navigate({ to: "/upload", search: { justPublishedId: created.id }, replace: true });
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const closeShareModal = () => navigate({ to: "/" });

  // A caption isn't actually required server-side (publishPost falls back to "Untitled" when
  // it's blank) — gating the button on a non-empty title made Publish silently do nothing for
  // anyone who skipped the caption field, indistinguishable from a broken button.
  const canPublish = !!audioUrl && !publishMutation.isPending;

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <h1 className="font-display text-2xl font-bold">{t("upload.title")}</h1>

        {draftId ? (
          <div className="mt-4 flex items-center gap-3 rounded-3xl border border-accent/40 bg-accent/5 p-4">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-accent" />
            <div className="flex-1">
              <p className="text-sm font-semibold">{t("upload.recordedReady")}</p>
              <p className="text-xs text-muted-foreground">{t("upload.fromRecordStudio")}</p>
            </div>
            <button
              onClick={togglePreview}
              className="grid h-10 w-10 place-items-center rounded-full glass"
              disabled={!draft?.audioUrl}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
          </div>
        ) : pickedFile ? (
          <div className="mt-4 flex items-center gap-3 rounded-3xl border border-accent/40 bg-accent/5 p-4">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-accent" />
            <div className="flex-1">
              <p className="line-clamp-1 text-sm font-semibold">{pickedFile.name}</p>
              <p className="text-xs text-muted-foreground">{t("upload.uploadedLabel")}</p>
            </div>
            <button
              onClick={togglePreview}
              className="grid h-10 w-10 place-items-center rounded-full glass"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-3xl border-2 border-dashed border-border bg-card/40 p-6 text-center">
            <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-semibold">
              {uploadFileMutation.isPending ? t("upload.uploading") : t("upload.tapToUpload")}
            </p>
            <p className="text-xs text-muted-foreground">{t("upload.fileTypes")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadFileMutation.mutate(file);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadFileMutation.isPending}
              className="mt-3 rounded-full gradient-neon px-5 py-2 text-xs font-bold text-white glow-pink disabled:opacity-60"
            >
              {t("upload.chooseFile")}
            </button>
          </div>
        )}

        <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("upload.pickType")}
        </p>
        <div className="grid grid-cols-4 gap-2">
          {types.map((tp) => (
            <button
              key={tp.key}
              onClick={() => setType(tp.key)}
              className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-[11px] font-semibold ${
                type === tp.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card/60"
              }`}
            >
              <tp.icon className="h-4 w-4" /> {t(tp.labelKey)}
            </button>
          ))}
        </div>
        {type === "competition" && (
          <p className="mt-2 text-[11px] text-accent">{t("upload.competitionNote")}</p>
        )}

        <div className="mt-5 space-y-3">
          <Field label={t("upload.caption")}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input"
              placeholder={t("upload.titlePlaceholder")}
            />
          </Field>
          <Field label={t("upload.description")}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="input"
              placeholder={t("upload.descPlaceholder")}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("upload.category")}>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="input"
              >
                <option>Pop</option>
                <option>Hip-Hop</option>
                <option>Electronic</option>
                <option>Rock</option>
                <option>R&B</option>
              </select>
            </Field>
            <Field label={t("upload.tags")}>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="input"
                placeholder={t("upload.tagsPlaceholder")}
              />
            </Field>
          </div>

          <fieldset className="rounded-2xl border border-border bg-card/40 p-3">
            <legend className="px-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("upload.credits")}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={performer}
                onChange={(e) => setPerformer(e.target.value)}
                className="input"
                placeholder={t("upload.performer")}
              />
              <input
                value={writer}
                onChange={(e) => setWriter(e.target.value)}
                className="input"
                placeholder={t("upload.writer")}
              />
              <input
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                className="input"
                placeholder={t("upload.composer")}
              />
              <input
                value={producer}
                onChange={(e) => setProducer(e.target.value)}
                className="input"
                placeholder={t("upload.producer")}
              />
            </div>
          </fieldset>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("upload.coverImage")}
            </p>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/40 p-3">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl">
                <PostCoverBg hue={280} seed={draftId ?? "new"} imageUrl={coverUrl ?? undefined} />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">
                  {coverUrl ? t("upload.coverReady") : t("upload.coverHint")}
                </p>
                <button
                  type="button"
                  onClick={() => coverMutation.mutate()}
                  disabled={coverMutation.isPending}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-60"
                >
                  {coverMutation.isPending ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {coverMutation.isPending
                    ? t("upload.generatingCover")
                    : coverUrl
                      ? t("upload.regenerateCover")
                      : t("upload.generateCover")}
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("upload.visibility")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setV("public")}
                className={`flex items-center justify-center gap-2 rounded-2xl border p-3 text-sm font-semibold ${visibility === "public" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/60"}`}
              >
                <Globe className="h-4 w-4" /> {t("upload.public")}
              </button>
              <button
                onClick={() => setV("private")}
                className={`flex items-center justify-center gap-2 rounded-2xl border p-3 text-sm font-semibold ${visibility === "private" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/60"}`}
              >
                <Lock className="h-4 w-4" /> {t("upload.private")}
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={() => publishMutation.mutate()}
          disabled={!canPublish}
          className="mt-6 w-full rounded-full gradient-neon py-3 text-sm font-bold text-white glow-pink disabled:opacity-50"
        >
          {publishMutation.isPending ? t("upload.publishing") : t("common.publish")}
        </button>
      </div>

      <style>{`.input { width: 100%; border-radius: 12px; background: var(--color-input); padding: 10px 12px; font-size: 14px; outline: none; border: 1px solid var(--color-border); }
      .input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 25%, transparent); }`}</style>

      <PublishEverywhereModal
        open={!!justPublishedId && !!publishedPost}
        onOpenChange={(next) => {
          if (!next) closeShareModal();
        }}
        post={publishedPost}
      />
    </AppShell>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
