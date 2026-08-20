import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Settings,
  BadgeCheck,
  MessageSquare,
  Share2,
  X,
  Youtube,
  Music2,
  Disc3,
  Ticket,
  BookOpen,
  Globe,
  Instagram,
  Plus,
  Trash2,
  CalendarDays,
  MapPin,
} from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { getProfileByHandle, listUserPosts, updateProfile } from "@/functions/profile";
import {
  updateArtistLinks,
  listArtistSongs,
  addArtistSong,
  deleteArtistSong,
  listArtistShows,
  addArtistShow,
  deleteArtistShow,
} from "@/functions/artist";
import { listUserCompetitionEntries } from "@/functions/competitions";
import { toggleFollow, listMyDrafts } from "@/functions/posts";
import { getOrCreateConversation } from "@/functions/messages";
import { smartUploadMedia } from "@/lib/blob-upload";
import { logout } from "@/functions/auth";
import { formatCount } from "@/lib/mock-data";
import { shareContent } from "@/lib/share";

const tabs = ["videos", "songs", "covers", "drafts", "live", "competitions", "about"] as const;

export function ProfileView({ handle }: { handle: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof tabs)[number]>("videos");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["profile", handle],
    queryFn: () => getProfileByHandle({ data: { handle } }),
  });
  const { data: posts } = useQuery({
    queryKey: ["userPosts", handle],
    queryFn: () => listUserPosts({ data: { handle } }),
  });
  const { data: entries } = useQuery({
    queryKey: ["userCompetitionEntries", handle],
    queryFn: () => listUserCompetitionEntries({ data: { handle } }),
    enabled: tab === "competitions",
  });
  const { data: drafts } = useQuery({
    queryKey: ["myDrafts"],
    queryFn: () => listMyDrafts(),
    enabled: tab === "drafts" && !!profile?.isMe,
  });
  const isArtist = profile?.accountType === "artist";
  const { data: artistSongs } = useQuery({
    queryKey: ["artistSongs", handle],
    queryFn: () => listArtistSongs({ data: { handle } }),
    enabled: tab === "about" && isArtist,
  });
  const { data: artistShows } = useQuery({
    queryKey: ["artistShows", handle],
    queryFn: () => listArtistShows({ data: { handle } }),
    enabled: tab === "about" && isArtist,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["profile", handle] });
  const invalidateSongs = () => queryClient.invalidateQueries({ queryKey: ["artistSongs", handle] });
  const invalidateShows = () => queryClient.invalidateQueries({ queryKey: ["artistShows", handle] });

  const addSongMutation = useMutation({
    mutationFn: (input: { title: string; releaseYear?: number }) =>
      addArtistSong({ data: input }),
    onSuccess: () => {
      invalidateSongs();
      toast.success(t("profile.artist.songAdded"));
    },
  });
  const deleteSongMutation = useMutation({
    mutationFn: (id: string) => deleteArtistSong({ data: { id } }),
    onSuccess: invalidateSongs,
  });
  const addShowMutation = useMutation({
    mutationFn: (input: { title: string; venue?: string; city?: string; ticketUrl?: string }) =>
      addArtistShow({ data: input }),
    onSuccess: () => {
      invalidateShows();
      toast.success(t("profile.artist.showAdded"));
    },
  });
  const deleteShowMutation = useMutation({
    mutationFn: (id: string) => deleteArtistShow({ data: { id } }),
    onSuccess: invalidateShows,
  });

  const followMutation = useMutation({
    mutationFn: () => toggleFollow({ data: { userId: profile!.id } }),
    onSuccess: invalidate,
  });

  const messageMutation = useMutation({
    mutationFn: () => getOrCreateConversation({ data: { otherUserId: profile!.id } }),
    onSuccess: (conversation) =>
      navigate({ to: "/messages/$conversationId", params: { conversationId: conversation.id } }),
  });

  if (!profile) {
    return (
      <AppShell>
        <TopBar />
      </AppShell>
    );
  }

  const shownPosts =
    tab === "songs"
      ? posts?.filter((p) => p.type === "original" || p.type === "cover")
      : tab === "covers"
        ? posts?.filter((p) => p.type === "cover")
        : tab === "videos"
          ? posts
          : [];

  return (
    <AppShell>
      <TopBar />
      <div className="relative">
        <div className="h-40 gradient-neon opacity-70" />
        {profile.isMe && (
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <button
              onClick={async () => {
                const url = `${window.location.origin}/profile/${profile.handle}`;
                const result = await shareContent({ title: profile.name, url });
                if (result === "copied") toast.success(t("profile.linkCopied"));
              }}
              className="rounded-full glass p-2"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button onClick={() => setSettingsOpen(true)} className="rounded-full glass p-2">
              <Settings className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="-mt-12 px-4">
          <img
            src={profile.avatarUrl}
            alt=""
            className="h-24 w-24 rounded-full border-4 border-background"
          />
          <div className="mt-2 flex items-center gap-1">
            <h1 className="font-display text-xl font-bold">{profile.name}</h1>
            {profile.verified && <BadgeCheck className="h-5 w-5 text-accent" />}
          </div>
          <p className="text-sm text-muted-foreground">
            @{profile.handle}
            {profile.verified ? ` · ${t("profile.verified")}` : ""}
          </p>
          {profile.bio && <p className="mt-2 max-w-md text-sm">{profile.bio}</p>}

          <div className="mt-3 flex items-center gap-3 text-sm">
            <Stat n={profile.followerCount} k={t("profile.followers")} />
            <Stat n={profile.followingCount} k={t("profile.following")} />
            <Stat n={profile.likesTotal} k={t("profile.likes")} />
          </div>

          {!profile.isMe && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => followMutation.mutate()}
                className={`flex-1 rounded-full py-2 text-sm font-bold ${
                  profile.isFollowing
                    ? "border border-border bg-card text-foreground"
                    : "gradient-neon text-white glow-pink"
                }`}
              >
                {profile.isFollowing ? t("common.following") : t("common.follow")}
              </button>
              <button
                onClick={() => messageMutation.mutate()}
                className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold"
              >
                <MessageSquare className="h-4 w-4" />
              </button>
              <button
                onClick={async () => {
                  const url = `${window.location.origin}/profile/${profile.handle}`;
                  const result = await shareContent({ title: profile.name, url });
                  if (result === "copied") toast.success(t("profile.linkCopied"));
                }}
                className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          )}

          {isArtist && <ArtistLinksRow links={profile.artistLinks} />}
        </div>

        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border px-2 no-scrollbar">
          {tabs
            .filter((k) => k !== "drafts" || profile.isMe)
            .map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`shrink-0 border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider ${
                  tab === k
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground"
                }`}
              >
                {t(`profile.${k}`)}
              </button>
            ))}
        </div>

        {tab === "about" ? (
          <div className="p-4 text-sm">
            <h3 className="font-semibold">{t("profile.about")}</h3>
            <p className="mt-1 text-muted-foreground">{profile.bio || t("profile.noBioYet")}</p>
            {profile.voiceType && (
              <p className="mt-2 text-muted-foreground">
                {profile.voiceType}
                {profile.country ? ` · ${profile.country}` : ""}
              </p>
            )}
            {profile.openToLabel && (
              <p className="mt-2 text-accent">{t("profile.openToLabelOffers")}</p>
            )}

            {isArtist && (
              <ArtistDiscography
                songs={artistSongs}
                canEdit={!!profile.isMe}
                onAdd={(input) => addSongMutation.mutate(input)}
                onDelete={(id) => deleteSongMutation.mutate(id)}
              />
            )}

            {isArtist && (
              <ArtistShows
                shows={artistShows}
                canEdit={!!profile.isMe}
                onAdd={(input) => addShowMutation.mutate(input)}
                onDelete={(id) => deleteShowMutation.mutate(id)}
              />
            )}
          </div>
        ) : tab === "live" ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t("profile.noLiveSessions")}
          </div>
        ) : tab === "drafts" ? (
          <div className="space-y-2 p-4">
            {drafts?.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">{t("profile.noDrafts")}</p>
            )}
            {drafts?.map((d) => (
              <Link
                key={d.id}
                to="/upload"
                search={{ draftId: d.id }}
                className="flex items-center justify-between rounded-2xl border border-border bg-card/60 p-3"
              >
                <span className="line-clamp-1 text-sm font-semibold">{d.title}</span>
                <span className="shrink-0 text-xs text-accent">
                  {t("profile.finishPublishing")}
                </span>
              </Link>
            ))}
          </div>
        ) : tab === "competitions" ? (
          <div className="space-y-2 p-4">
            {entries?.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">
                {t("profile.noCompetitionEntries")}
              </p>
            )}
            {entries?.map((e) => (
              <Link
                key={e.id}
                to="/competitions/$id"
                params={{ id: e.competitionId }}
                className="flex items-center justify-between rounded-2xl border border-border bg-card/60 p-3"
              >
                <span className="text-sm font-semibold">{e.competitionTitle}</span>
                <span className="text-xs text-muted-foreground">
                  {t("comp.votesCount", { n: e.votesCount })}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1 p-1">
            {shownPosts?.length === 0 && (
              <p className="col-span-3 py-6 text-center text-sm text-muted-foreground">
                {t("profile.nothingHereYet")}
              </p>
            )}
            {shownPosts?.map((p) => (
              <div key={p.id} className="relative aspect-[3/4] overflow-hidden">
                <PostCoverBg hue={p.hue} seed={p.id} imageUrl={p.coverUrl} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[10px] font-semibold text-white">
                  ▶ {formatCount(p.likesCount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {profile.isMe && (
        <SettingsSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          profile={profile}
        />
      )}
    </AppShell>
  );
}

function Stat({ n, k }: { n: number; k: string }) {
  return (
    <div className="text-center">
      <p className="font-display text-lg font-bold">{formatCount(n)}</p>
      <p className="text-[11px] text-muted-foreground">{k}</p>
    </div>
  );
}

type Profile = NonNullable<Awaited<ReturnType<typeof getProfileByHandle>>>;
type ArtistSongList = Awaited<ReturnType<typeof listArtistSongs>>;
type ArtistShowList = Awaited<ReturnType<typeof listArtistShows>>;

function ArtistLinksRow({ links }: { links: Profile["artistLinks"] }) {
  const { t } = useTranslation();
  if (!links) return null;

  const pills = [
    { label: t("profile.artist.spotify"), icon: <Music2 className="h-3.5 w-3.5" />, url: links.spotifyUrl },
    { label: t("profile.artist.youtube"), icon: <Youtube className="h-3.5 w-3.5" />, url: links.youtubeUrl },
    { label: t("profile.artist.appleMusic"), icon: <Disc3 className="h-3.5 w-3.5" />, url: links.appleMusicUrl },
    { label: t("profile.artist.soundcloud"), icon: <Music2 className="h-3.5 w-3.5" />, url: links.soundcloudUrl },
    { label: t("profile.artist.instagram"), icon: <Instagram className="h-3.5 w-3.5" />, url: links.instagramUrl },
    { label: t("profile.artist.tiktok"), icon: <Disc3 className="h-3.5 w-3.5" />, url: links.tiktokUrl },
    { label: t("profile.artist.website"), icon: <Globe className="h-3.5 w-3.5" />, url: links.websiteUrl },
    { label: t("profile.artist.wikipedia"), icon: <BookOpen className="h-3.5 w-3.5" />, url: links.wikipediaUrl },
  ].filter((p) => p.url);

  if (pills.length === 0 && !links.ticketsUrl && !links.genre && !links.label) return null;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card/60 p-3">
      {(links.genre || links.label) && (
        <p className="text-xs text-muted-foreground">
          {[links.genre, links.label].filter(Boolean).join(" · ")}
        </p>
      )}
      {pills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {pills.map((p) => (
            <a
              key={p.label}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold"
            >
              {p.icon}
              {p.label}
            </a>
          ))}
        </div>
      )}
      {links.ticketsUrl && (
        <a
          href={links.ticketsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center justify-center gap-2 rounded-full gradient-neon py-2 text-sm font-bold text-white glow-pink"
        >
          <Ticket className="h-4 w-4" />
          {t("profile.artist.buyTickets")}
        </a>
      )}
    </div>
  );
}

function ArtistDiscography({
  songs,
  canEdit,
  onAdd,
  onDelete,
}: {
  songs: ArtistSongList | undefined;
  canEdit: boolean;
  onAdd: (input: { title: string; releaseYear?: number }) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("profile.artist.songs")}</h3>
        {canEdit && (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 text-xs font-semibold text-accent"
          >
            <Plus className="h-3.5 w-3.5" /> {t("profile.artist.addSong")}
          </button>
        )}
      </div>
      {(!songs || songs.length === 0) && (
        <p className="mt-1 text-muted-foreground">{t("profile.artist.noSongs")}</p>
      )}
      <div className="mt-2 space-y-2">
        {songs?.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-2xl border border-border bg-card/60 p-3"
          >
            <div>
              <p className="text-sm font-semibold">{s.title}</p>
              {s.releaseYear ? (
                <p className="text-xs text-muted-foreground">{s.releaseYear}</p>
              ) : null}
              <div className="mt-1 flex gap-2">
                {s.spotifyUrl && (
                  <a href={s.spotifyUrl} target="_blank" rel="noopener noreferrer">
                    <Music2 className="h-4 w-4 text-muted-foreground" />
                  </a>
                )}
                {s.youtubeUrl && (
                  <a href={s.youtubeUrl} target="_blank" rel="noopener noreferrer">
                    <Youtube className="h-4 w-4 text-muted-foreground" />
                  </a>
                )}
                {s.appleMusicUrl && (
                  <a href={s.appleMusicUrl} target="_blank" rel="noopener noreferrer">
                    <Disc3 className="h-4 w-4 text-muted-foreground" />
                  </a>
                )}
              </div>
            </div>
            {canEdit && (
              <button onClick={() => onDelete(s.id)} className="shrink-0 text-muted-foreground">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("profile.artist.addSong")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("profile.artist.songTitlePlaceholder")}
            />
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder={t("profile.artist.yearPlaceholder")}
              inputMode="numeric"
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => {
                if (!title.trim()) return;
                onAdd({ title, releaseYear: year ? Number(year) : undefined });
                setTitle("");
                setYear("");
                setOpen(false);
              }}
              className="w-full rounded-full gradient-neon py-2.5 text-sm font-bold text-white glow-pink"
            >
              {t("common.save")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArtistShows({
  shows,
  canEdit,
  onAdd,
  onDelete,
}: {
  shows: ArtistShowList | undefined;
  canEdit: boolean;
  onAdd: (input: { title: string; venue?: string; city?: string; ticketUrl?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [city, setCity] = useState("");
  const [ticketUrl, setTicketUrl] = useState("");

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("profile.artist.shows")}</h3>
        {canEdit && (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 text-xs font-semibold text-accent"
          >
            <Plus className="h-3.5 w-3.5" /> {t("profile.artist.addShow")}
          </button>
        )}
      </div>
      {(!shows || shows.length === 0) && (
        <p className="mt-1 text-muted-foreground">{t("profile.artist.noShows")}</p>
      )}
      <div className="mt-2 space-y-2">
        {shows?.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-2xl border border-border bg-card/60 p-3"
          >
            <div>
              <p className="text-sm font-semibold">{s.title}</p>
              {(s.venue || s.city) && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {[s.venue, s.city].filter(Boolean).join(" · ")}
                </p>
              )}
              {s.showDate && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDays className="h-3 w-3" />
                  {new Date(s.showDate).toLocaleDateString()}
                </p>
              )}
              {s.ticketUrl && (
                <a
                  href={s.ticketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent"
                >
                  <Ticket className="h-3 w-3" /> {t("profile.artist.buyTickets")}
                </a>
              )}
            </div>
            {canEdit && (
              <button onClick={() => onDelete(s.id)} className="shrink-0 text-muted-foreground">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("profile.artist.addShow")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("profile.artist.showTitlePlaceholder")}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder={t("profile.artist.venuePlaceholder")}
              />
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={t("profile.artist.cityPlaceholder")}
              />
            </div>
            <Input
              value={ticketUrl}
              onChange={(e) => setTicketUrl(e.target.value)}
              placeholder={t("profile.artist.ticketsPlaceholder")}
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => {
                if (!title.trim()) return;
                onAdd({ title, venue, city, ticketUrl });
                setTitle("");
                setVenue("");
                setCity("");
                setTicketUrl("");
                setOpen(false);
              }}
              className="w-full rounded-full gradient-neon py-2.5 text-sm font-bold text-white glow-pink"
            >
              {t("common.save")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SettingsSheet({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  profile: Profile;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [voiceType, setVoiceType] = useState(profile.voiceType);
  const [country, setCountry] = useState(profile.country);
  const [openToLabel, setOpenToLabel] = useState(profile.openToLabel);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [isArtistAccount, setIsArtistAccount] = useState(profile.accountType === "artist");
  const [artistLinks, setArtistLinks] = useState({
    genre: profile.artistLinks?.genre ?? "",
    label: profile.artistLinks?.label ?? "",
    spotifyUrl: profile.artistLinks?.spotifyUrl ?? "",
    youtubeUrl: profile.artistLinks?.youtubeUrl ?? "",
    appleMusicUrl: profile.artistLinks?.appleMusicUrl ?? "",
    soundcloudUrl: profile.artistLinks?.soundcloudUrl ?? "",
    instagramUrl: profile.artistLinks?.instagramUrl ?? "",
    tiktokUrl: profile.artistLinks?.tiktokUrl ?? "",
    websiteUrl: profile.artistLinks?.websiteUrl ?? "",
    wikipediaUrl: profile.artistLinks?.wikipediaUrl ?? "",
    ticketsUrl: profile.artistLinks?.ticketsUrl ?? "",
  });
  const setArtistLink = (key: keyof typeof artistLinks) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setArtistLinks((prev) => ({ ...prev, [key]: e.target.value }));
  const fileRef = useRef<HTMLInputElement | null>(null);

  const avatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const { url } = await smartUploadMedia(file, file.name);
      return url;
    },
    onSuccess: setAvatarUrl,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await updateProfile({
        data: {
          name,
          bio,
          avatarUrl,
          voiceType,
          country,
          openToLabel,
          accountType: isArtistAccount ? "artist" : "user",
        },
      });
      if (isArtistAccount) await updateArtistLinks({ data: artistLinks });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", profile.handle] });
      toast.success(t("profile.updated"));
      onClose();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      queryClient.setQueryData(["currentUser"], null);
      navigate({ to: "/login" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>{t("profile.edit")}</SheetTitle>
        </SheetHeader>
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-3">
            <img src={avatarUrl ?? profile.avatarUrl} className="h-16 w-16 rounded-full" alt="" />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) avatarMutation.mutate(file);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
            >
              {t("profile.changePhoto")}
            </button>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            placeholder={t("profile.namePlaceholder")}
          />
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="input"
            placeholder={t("profile.bioPlaceholder")}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={voiceType}
              onChange={(e) => setVoiceType(e.target.value)}
              className="input"
              placeholder={t("profile.voiceGenrePlaceholder")}
            />
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="input"
              placeholder={t("profile.countryPlaceholder")}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={openToLabel}
              onChange={(e) => setOpenToLabel(e.target.checked)}
            />
            {t("profile.openToLabelCheckbox")}
          </label>

          <div className="flex items-center justify-between rounded-2xl border border-border bg-card/60 p-3">
            <div>
              <p className="text-sm font-semibold">{t("profile.artist.accountToggle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("profile.artist.accountToggleHint")}
              </p>
            </div>
            <Switch checked={isArtistAccount} onCheckedChange={setIsArtistAccount} />
          </div>

          {isArtistAccount && (
            <div className="space-y-2 rounded-2xl border border-border bg-card/60 p-3">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={artistLinks.genre}
                  onChange={setArtistLink("genre")}
                  className="input"
                  placeholder={t("profile.artist.genrePlaceholder")}
                />
                <input
                  value={artistLinks.label}
                  onChange={setArtistLink("label")}
                  className="input"
                  placeholder={t("profile.artist.labelPlaceholder")}
                />
              </div>
              <input
                value={artistLinks.spotifyUrl}
                onChange={setArtistLink("spotifyUrl")}
                className="input"
                placeholder={t("profile.artist.spotifyPlaceholder")}
              />
              <input
                value={artistLinks.youtubeUrl}
                onChange={setArtistLink("youtubeUrl")}
                className="input"
                placeholder={t("profile.artist.youtubePlaceholder")}
              />
              <input
                value={artistLinks.appleMusicUrl}
                onChange={setArtistLink("appleMusicUrl")}
                className="input"
                placeholder={t("profile.artist.appleMusicPlaceholder")}
              />
              <input
                value={artistLinks.soundcloudUrl}
                onChange={setArtistLink("soundcloudUrl")}
                className="input"
                placeholder={t("profile.artist.soundcloudPlaceholder")}
              />
              <input
                value={artistLinks.instagramUrl}
                onChange={setArtistLink("instagramUrl")}
                className="input"
                placeholder={t("profile.artist.instagramPlaceholder")}
              />
              <input
                value={artistLinks.tiktokUrl}
                onChange={setArtistLink("tiktokUrl")}
                className="input"
                placeholder={t("profile.artist.tiktokPlaceholder")}
              />
              <input
                value={artistLinks.websiteUrl}
                onChange={setArtistLink("websiteUrl")}
                className="input"
                placeholder={t("profile.artist.websitePlaceholder")}
              />
              <input
                value={artistLinks.wikipediaUrl}
                onChange={setArtistLink("wikipediaUrl")}
                className="input"
                placeholder={t("profile.artist.wikipediaPlaceholder")}
              />
              <input
                value={artistLinks.ticketsUrl}
                onChange={setArtistLink("ticketsUrl")}
                className="input"
                placeholder={t("profile.artist.ticketsPlaceholder")}
              />
            </div>
          )}

          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full rounded-full gradient-neon py-2.5 text-sm font-bold text-white glow-pink disabled:opacity-60"
          >
            {t("common.save")}
          </button>
          <button
            onClick={() => logoutMutation.mutate()}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-border py-2.5 text-sm font-semibold text-muted-foreground"
          >
            <X className="h-4 w-4" /> {t("auth.logout")}
          </button>
        </div>

        <style>{`.input { width: 100%; border-radius: 12px; background: var(--color-input); padding: 10px 12px; font-size: 14px; outline: none; border: 1px solid var(--color-border); }`}</style>
      </SheetContent>
    </Sheet>
  );
}
