import { useTranslation } from "react-i18next";
import { X, MoreVertical } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PostCoverBg } from "@/components/PostCoverBg";
import type { listUserPosts } from "@/functions/profile";

type PostRow = Awaited<ReturnType<typeof listUserPosts>>[number];

/**
 * The "open" view for a profile grid tile — a real player (actual video playback for camera
 * takes, cover + audio for everything else) rather than the grid's own muted/no-playback
 * thumbnail, with the post's own management options (via onOptions, opening PostActionsSheet)
 * reachable right on top of it instead of only from the small grid-tile corner button.
 */
export function PostViewerDialog({
  post,
  isMe,
  onClose,
  onOptions,
}: {
  post: PostRow | null;
  isMe: boolean;
  onClose: () => void;
  onOptions: (post: PostRow) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={!!post} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-black p-0 sm:rounded-none"
      >
        {post && (
          <div className="relative flex h-full w-full flex-col items-center justify-center">
            {post.videoUrl ? (
              <video
                key={post.id}
                src={post.videoUrl}
                poster={post.coverUrl || undefined}
                controls
                autoPlay
                playsInline
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-6">
                <div className="relative h-64 w-64 max-w-full overflow-hidden rounded-3xl shadow-pop-lg">
                  <PostCoverBg hue={post.hue} seed={post.id} imageUrl={post.coverUrl} />
                </div>
                {post.audioUrl && (
                  <audio
                    key={post.id}
                    src={post.audioUrl}
                    controls
                    autoPlay
                    className="w-full max-w-sm"
                  />
                )}
              </div>
            )}

            <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
              <button
                onClick={onClose}
                aria-label={t("common.close")}
                className="grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white press-scale"
              >
                <X className="h-5 w-5" />
              </button>
              {isMe && (
                <button
                  onClick={() => onOptions(post)}
                  aria-label={t("profile.postActions.title")}
                  className="grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white press-scale"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
              )}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-10 text-white">
              <p className="line-clamp-1 text-sm font-semibold">
                {post.title || t("upload.untitled")}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
