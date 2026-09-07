import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Sparkles, RefreshCw, Upload } from "lucide-react";
import { PostCoverBg } from "@/components/PostCoverBg";
import { generateCoverImage } from "@/functions/cover-image";
import { smartUploadMedia } from "@/lib/blob-upload";
import { translateServerError } from "@/lib/i18n";

/**
 * The cover-image card from the publish screen (AI-generate + manual-upload, image or video) —
 * shared with Studio's "replace video with a cover image" action so both screens use the exact
 * same picker rather than two copies of it.
 */
export function CoverImagePicker({
  coverUrl,
  videoUrl,
  coverSubject,
  category,
  seed,
  onCoverGenerated,
  onFileUploaded,
}: {
  coverUrl: string | null | undefined;
  videoUrl?: string | null;
  coverSubject: string;
  category: string;
  seed: string;
  onCoverGenerated: (url: string) => void;
  onFileUploaded: (result: { url: string; isVideo: boolean }) => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const coverMutation = useMutation({
    mutationFn: () => generateCoverImage({ data: { songTitle: coverSubject, category } }),
    onSuccess: (result) => onCoverGenerated(result.url),
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const { url } = await smartUploadMedia(file, file.name);
      return { url, isVideo: file.type.startsWith("video/") };
    },
    onSuccess: onFileUploaded,
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <div className="relative h-56 w-full overflow-hidden rounded-3xl border border-border">
      <PostCoverBg hue={280} seed={seed} imageUrl={coverUrl ?? undefined} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      {!coverUrl && !videoUrl && (
        <div className="absolute inset-0 grid place-items-center">
          <Sparkles className="h-10 w-10 text-white/25" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p className="mb-2 text-xs text-white/80">
          {videoUrl
            ? t("upload.videoAttached")
            : coverUrl
              ? t("upload.coverReady")
              : t("upload.coverHint")}
        </p>
        <div className="flex flex-wrap gap-2">
          <motion.button
            type="button"
            onClick={() => coverMutation.mutate()}
            disabled={coverMutation.isPending}
            whileTap={coverMutation.isPending ? undefined : { scale: 0.95 }}
            whileHover={coverMutation.isPending ? undefined : { scale: 1.03 }}
            transition={{ type: "spring", stiffness: 450, damping: 28 }}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-coral px-4 py-2 text-xs font-bold text-white shadow-pop-coral disabled:opacity-60"
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
          </motion.button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
            }}
          />
          <motion.button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            whileTap={uploadMutation.isPending ? undefined : { scale: 0.95 }}
            whileHover={uploadMutation.isPending ? undefined : { scale: 1.03 }}
            transition={{ type: "spring", stiffness: 450, damping: 28 }}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/10 px-4 py-2 text-xs font-bold text-white backdrop-blur-sm disabled:opacity-60"
          >
            {uploadMutation.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {t("upload.uploadOwnCover")}
          </motion.button>
        </div>
      </div>
    </div>
  );
}
