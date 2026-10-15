import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Music2, Play, Pause, Mic } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { EmptyState } from "@/components/EmptyState";
import { formatCount } from "@/lib/mock-data";
import { getKaraokeTrack, listKaraokeTrackPosts } from "@/functions/karaoke";

export const Route = createFileRoute("/sound_/$id")({
  component: SoundPage,
});

type TrackPost = Awaited<ReturnType<typeof listKaraokeTrackPosts>>[number];

// A song's "sound page" — reached by tapping the spinning-disc icon or the song name on a karaoke
// post in the feed. Mirrors TikTok's sound-detail screen: the track itself, how many published
// takes were recorded over it, a primary "Use this sound" button that jumps straight into /record
// with this exact track pre-selected, and a grid of every video that used it.
function SoundPage() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [playingId, setPlayingId] = useState<string | null>(null);

  const { data: track, isPending } = useQuery({
    queryKey: ["karaokeTrack", id],
    queryFn: () => getKaraokeTrack({ data: { id } }),
    // A bad/unknown id is a final answer — retrying only keeps the skeleton up for ~7s.
    retry: false,
  });
  const { data: trackPosts } = useQuery({
    queryKey: ["karaokeTrackPosts", id],
    queryFn: () => listKaraokeTrackPosts({ data: { karaokeTrackId: id } }),
  });

  if (!track) {
    return (
      <AppShell>
        <TopBar />
        {isPending ? (
          <div className="px-4 pt-3" aria-busy>
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="mt-3 flex items-center gap-4 rounded-3xl border border-border bg-card p-4">
              <div className="h-20 w-20 shrink-0 animate-pulse rounded-2xl bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={Music2}
            title={t("sound.notFound")}
            className="mt-16"
            action={
              <Link
                to="/"
                className="rounded-full border border-border px-5 py-2 text-sm font-semibold press-scale"
              >
                {t("nav.home")}
              </Link>
            }
          />
        )}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pb-6 pt-3">
        <Link to="/" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" /> {t("nav.home")}
        </Link>

        <div className="flex items-center gap-4 rounded-3xl border border-border bg-card p-4 shadow-pop">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-indigo shadow-pop">
            {track.artistImageUrl ? (
              <img src={track.artistImageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Music2 className="h-8 w-8 text-white" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-lg font-bold">{track.title}</p>
            {track.artist && (
              <p className="line-clamp-1 text-sm text-muted-foreground">{track.artist}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {t("sound.usageCount", { count: track.usageCount })}
            </p>
          </div>
        </div>

        <button
          onClick={() => navigate({ to: "/record", search: { trackId: track.id } })}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-brand-coral py-3 text-sm font-bold text-white shadow-pop-coral press-scale"
        >
          <Mic className="h-4 w-4" />
          {t("sound.useThisSound")}
        </button>

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("sound.videosHeading")}
        </h2>
        {trackPosts?.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">{t("sound.noVideosYet")}</p>
        )}
        <div className="mt-2 grid grid-cols-3 gap-1">
          {trackPosts?.map((p) => (
            <SoundPostCell
              key={p.id}
              post={p}
              playing={playingId === p.id}
              onToggle={() => setPlayingId((cur) => (cur === p.id ? null : p.id))}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

// One grid cell: a cover thumbnail with a play/pause toggle, same visual language as the profile
// grid (ProfileView.tsx). Tapping plays the take inline right in the grid — a <video> if this post
// has one (the common case for a karaoke take), an invisible <audio> otherwise, mounted only while
// actually playing rather than kept as one shared player, since each cell needs its own on-screen
// video frame instead of a single hidden element.
function SoundPostCell({
  post,
  playing,
  onToggle,
}: {
  post: TrackPost;
  playing: boolean;
  onToggle: () => void;
}) {
  const media = post.videoUrl || post.audioUrl;
  return (
    <button
      onClick={onToggle}
      className="press-scale relative aspect-[3/4] cursor-pointer overflow-hidden"
    >
      {playing && media ? (
        post.videoUrl ? (
          <video
            src={post.videoUrl}
            autoPlay
            playsInline
            onEnded={onToggle}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <>
            <PostCoverBg hue={post.hue} seed={post.id} imageUrl={post.coverUrl} />
            <audio src={post.audioUrl} autoPlay onEnded={onToggle} className="hidden" />
          </>
        )
      ) : (
        <PostCoverBg hue={post.hue} seed={post.id} imageUrl={post.coverUrl} />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={`grid place-items-center rounded-full bg-black/50 backdrop-blur-sm transition-all ${
            playing ? "h-11 w-11 bg-brand-coral/80" : "h-9 w-9"
          }`}
        >
          {playing ? (
            <Pause className="h-4 w-4 fill-white text-white" />
          ) : (
            <Play className="h-4 w-4 fill-white text-white" />
          )}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[10px] font-semibold text-white">
        <img src={post.user.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
        <span className="line-clamp-1">{post.user.name}</span>
        <span className="ms-auto">{formatCount(post.likesCount)}</span>
      </div>
    </button>
  );
}
