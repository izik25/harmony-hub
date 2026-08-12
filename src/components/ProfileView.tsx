import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Settings, BadgeCheck, MessageSquare, Share2, X } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getProfileByHandle, listUserPosts, updateProfile } from "@/functions/profile";
import { listUserCompetitionEntries } from "@/functions/competitions";
import { toggleFollow, listMyDrafts } from "@/functions/posts";
import { getOrCreateConversation } from "@/functions/messages";
import { uploadMedia } from "@/functions/uploads";
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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["profile", handle] });

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
                <PostCoverBg hue={p.hue} seed={p.id} />
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
  const fileRef = useRef<HTMLInputElement | null>(null);

  const avatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const { url } = await uploadMedia({ data: formData });
      return url;
    },
    onSuccess: setAvatarUrl,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      updateProfile({ data: { name, bio, avatarUrl, voiceType, country, openToLabel } }),
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
