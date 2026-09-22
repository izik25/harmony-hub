import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  LiveKitRoom,
  useTracks,
  useParticipants,
  ParticipantTile,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { ArrowLeft, Radio, Plus, X, Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PkBattlePanel } from "@/components/PkBattle";
import { joinRoom, endRoom, listLiveRoomGuests, inviteGuest, removeGuest } from "@/functions/live";
import { searchAll } from "@/functions/search";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/live_/$roomId")({
  component: LiveRoomPage,
});

type Role = "host" | "guest" | "viewer";
type UserBrief = { id: string; name: string; handle: string; avatarUrl: string };
type Session = {
  token: string;
  livekitUrl: string;
  role: Role;
  type: string;
  host: UserBrief | null;
};

function LiveRoomPage() {
  const { t } = useTranslation();
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const endMutation = useMutation({
    mutationFn: () => endRoom({ data: { roomId } }),
    onSuccess: () => navigate({ to: "/live" }),
  });

  useEffect(() => {
    const hostSession = sessionStorage.getItem(`sona-live-host-${roomId}`);
    if (hostSession) {
      const parsed = JSON.parse(hostSession);
      setSession({
        token: parsed.token,
        livekitUrl: parsed.livekitUrl,
        role: "host",
        type: parsed.type ?? "set",
        host: parsed.host ?? null,
      });
      return;
    }
    joinRoom({ data: { roomId } })
      .then((res) =>
        setSession({
          token: res.token,
          livekitUrl: res.livekitUrl!,
          role: res.role,
          type: res.room.type,
          host: res.host ?? null,
        }),
      )
      .catch((e: Error) => {
        const message = translateServerError(e.message);
        setError(message);
        toast.error(message);
      });
  }, [roomId]);

  if (error) {
    return (
      <AppShell hideNav>
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <Radio className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Link
            to="/live"
            className="rounded-full bg-brand-coral px-5 py-2 text-sm font-semibold text-white shadow-pop-coral press-scale"
          >
            <ArrowLeft className="mr-1 inline h-4 w-4" /> {t("live.backToLive")}
          </Link>
        </div>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell hideNav>
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          {t("live.connecting")}
        </div>
      </AppShell>
    );
  }

  const canPublish = session.role !== "viewer";
  const isHost = session.role === "host";

  return (
    <AppShell hideNav>
      <div className="relative h-screen">
        <LiveKitRoom
          serverUrl={session.livekitUrl}
          token={session.token}
          connect
          video={canPublish}
          audio={canPublish}
          data-lk-theme="default"
          style={{ height: "100%" }}
          onDisconnected={() => navigate({ to: "/live" })}
        >
          <Roster roomId={roomId} hostId={session.host?.id} isHost={isHost} />
          <PkBattlePanel roomId={roomId} hostId={session.host?.id} isHost={isHost} />
        </LiveKitRoom>
        {isHost && (
          <button
            onClick={() => setInviteOpen(true)}
            className="absolute bottom-6 end-4 z-50 flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2.5 text-xs font-bold text-foreground shadow-pop-lg press-scale"
          >
            <Plus className="h-4 w-4" /> {t("live.invite")}
          </button>
        )}
        {isHost && (
          <button
            onClick={() => endMutation.mutate()}
            className="absolute right-3 top-3 z-50 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white shadow-pop-lg press-scale"
          >
            {t("live.endLive")}
          </button>
        )}
      </div>
      {isHost && (
        <InviteGuestSheet open={inviteOpen} onOpenChange={setInviteOpen} roomId={roomId} />
      )}
    </AppShell>
  );
}

// The on-stage tile grid: host + every "live" guest, rendered from real LiveKit camera tracks
// where published (a `ParticipantTile` per track), falling back to a plain avatar tile for anyone
// on the roster who hasn't actually connected/published video yet. Needs the room context
// (useTracks/useParticipants), so it only ever renders inside <LiveKitRoom>.
function Roster({
  roomId,
  hostId,
  isHost,
}: {
  roomId: string;
  hostId: string | undefined;
  isHost: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const participants = useParticipants();
  const trackRefs = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);

  const { data: guests } = useQuery({
    queryKey: ["liveRoomGuests", roomId],
    queryFn: () => listLiveRoomGuests({ data: { roomId } }),
    refetchInterval: 4000,
  });
  const liveGuests = (guests ?? []).filter((g) => g.status === "live");

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeGuest({ data: { roomId, userId } }),
    onSuccess: () => {
      toast.success(t("live.guestRemoved"));
      queryClient.invalidateQueries({ queryKey: ["liveRoomGuests", roomId] });
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const identities = new Set(participants.map((p) => p.identity));
  const onStage: Array<{ id: string; isHost: boolean }> = [
    ...(hostId ? [{ id: hostId, isHost: true }] : []),
    ...liveGuests.map((g) => ({ id: g.userId, isHost: false })),
  ];

  return (
    <div className="grid h-full auto-rows-fr grid-cols-2 gap-0.5 bg-black">
      {onStage.map((p) => {
        const trackRef = trackRefs.find((tr) => tr.participant.identity === p.id);
        const guest = liveGuests.find((g) => g.userId === p.id);
        return (
          <div key={p.id} className="relative overflow-hidden bg-neutral-900">
            {trackRef ? (
              <ParticipantTile trackRef={trackRef} className="h-full w-full" />
            ) : (
              <div className="grid h-full place-items-center">
                {guest && (
                  <img src={guest.user.avatarUrl} alt="" className="h-16 w-16 rounded-full" />
                )}
                {!guest && !identities.has(p.id) && (
                  <Radio className="h-8 w-8 animate-pulse text-white/40" />
                )}
              </div>
            )}
            {isHost && !p.isHost && (
              <button
                onClick={() => removeMutation.mutate(p.id)}
                aria-label={t("live.removeGuest")}
                className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white press-scale"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InviteGuestSheet({
  open,
  onOpenChange,
  roomId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");

  const { data } = useQuery({
    queryKey: ["searchUsersForInvite", query],
    queryFn: () => searchAll({ data: { query } }),
    enabled: open && query.trim().length > 0,
  });

  const inviteMutation = useMutation({
    mutationFn: (userId: string) => inviteGuest({ data: { roomId, userId } }),
    onSuccess: () => {
      toast.success(t("live.inviteSent"));
      queryClient.invalidateQueries({ queryKey: ["liveRoomGuests", roomId] });
      onOpenChange(false);
      setQuery("");
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>{t("live.invite")}</SheetTitle>
        </SheetHeader>
        <div className="mt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("live.searchPlaceholder")}
              className="w-full rounded-2xl border border-border bg-input py-2.5 ps-9 pe-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="mt-2 max-h-[50vh] space-y-1 overflow-y-auto">
            {query.trim().length > 0 && data?.users.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("live.noSearchResults")}
              </p>
            )}
            {data?.users.map((u) => (
              <button
                key={u.id}
                onClick={() => inviteMutation.mutate(u.id)}
                disabled={inviteMutation.isPending}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start press-scale hover:bg-muted disabled:opacity-60"
              >
                <img src={u.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{u.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">@{u.handle}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
