import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useDataChannel } from "@livekit/components-react";
import { Room, RoomEvent, Track } from "livekit-client";
import { Swords, X, Gift as GiftIcon } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  listLiveRooms,
  invitePkBattle,
  respondToPkBattle,
  endPkBattle,
  getPkBattle,
} from "@/functions/live";
import { listGiftCatalog, sendGift } from "@/functions/wallet";
import { translateServerError } from "@/lib/i18n";

type IncomingChallenge = { battleId: string; from: string };

/**
 * Everything PK-related for one live room: the host's "Battle" trigger (invite another currently-
 * live room), the incoming-challenge modal (via LiveKit's data channel — see pushLiveData in
 * functions/live.ts, arriving here through useDataChannel), and — once a battle is active — the
 * split-screen itself with a live score bar fed by gifts (functions/wallet.ts's sendGift).
 * Rendered inside <LiveKitRoom> (useDataChannel needs the room context).
 */
export function PkBattlePanel({
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [incoming, setIncoming] = useState<IncomingChallenge | null>(null);

  const { data: pk } = useQuery({
    queryKey: ["pkBattle", roomId],
    queryFn: () => getPkBattle({ data: { roomId } }),
    refetchInterval: 5000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["pkBattle", roomId] });

  useDataChannel((msg) => {
    let parsed: { kind: string; [key: string]: unknown };
    try {
      parsed = JSON.parse(new TextDecoder().decode(msg.payload));
    } catch {
      return;
    }
    switch (parsed.kind) {
      case "pk_challenge":
        if (isHost) {
          setIncoming({ battleId: String(parsed.battleId), from: String(parsed.from) });
        }
        break;
      case "pk_started":
        setIncoming(null);
        invalidate();
        break;
      case "pk_score":
      case "pk_ended":
      case "pk_declined":
        invalidate();
        break;
    }
  });

  const respondMutation = useMutation({
    mutationFn: (accept: boolean) =>
      respondToPkBattle({ data: { battleId: incoming!.battleId, accept } }),
    onSuccess: () => {
      setIncoming(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const battle = pk?.battle;
  const showActive = battle && battle.status === "active" && pk.otherRoom && pk.livekitUrl;

  return (
    <>
      {isHost && !battle && (
        <button
          onClick={() => setPickerOpen(true)}
          className="absolute bottom-6 start-4 z-50 flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2.5 text-xs font-bold text-foreground shadow-pop-lg press-scale"
        >
          <Swords className="h-4 w-4" /> {t("live.battle")}
        </button>
      )}

      {showActive && (
        <PkSplitScreen
          roomId={roomId}
          hostId={hostId}
          mySide={pk.mySide}
          battle={battle}
          otherRoom={pk.otherRoom!}
          livekitUrl={pk.livekitUrl!}
          viewToken={pk.viewToken}
          isHost={isHost}
        />
      )}

      <PkPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        roomId={roomId}
        onInvited={invalidate}
      />

      <Dialog open={!!incoming} onOpenChange={(v) => !v && setIncoming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-brand-gold" />
              {t("live.pkChallengeTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("live.pkChallengeHint", { name: incoming?.from })}
          </p>
          <DialogFooter>
            <button
              onClick={() => respondMutation.mutate(false)}
              disabled={respondMutation.isPending}
              className="rounded-full border border-border px-4 py-2.5 text-sm font-semibold press-scale disabled:opacity-60"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => respondMutation.mutate(true)}
              disabled={respondMutation.isPending}
              className="flex items-center justify-center gap-2 rounded-full bg-brand-coral px-4 py-2.5 text-sm font-bold text-white shadow-pop-coral press-scale disabled:opacity-60"
            >
              <Swords className="h-4 w-4" /> {t("live.pkAccept")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PkPickerSheet({
  open,
  onOpenChange,
  roomId,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  onInvited: () => void;
}) {
  const { t } = useTranslation();
  const { data: rooms } = useQuery({
    queryKey: ["liveRooms"],
    queryFn: () => listLiveRooms(),
    enabled: open,
  });
  const others = (rooms ?? []).filter((r) => r.id !== roomId);

  const inviteMutation = useMutation({
    mutationFn: (targetRoomId: string) => invitePkBattle({ data: { roomId, targetRoomId } }),
    onSuccess: () => {
      toast.success(t("live.pkInviteSent"));
      onInvited();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>{t("live.battle")}</SheetTitle>
        </SheetHeader>
        <div className="mt-2 max-h-[50vh] space-y-1 overflow-y-auto">
          {others.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("live.noOneLive")}</p>
          )}
          {others.map((r) => (
            <button
              key={r.id}
              onClick={() => inviteMutation.mutate(r.id)}
              disabled={inviteMutation.isPending}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start press-scale hover:bg-muted disabled:opacity-60"
            >
              <img src={r.host.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.host.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.title}</span>
              </span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

type PkBattleRow = Awaited<ReturnType<typeof getPkBattle>>;

function PkSplitScreen({
  roomId,
  hostId,
  mySide,
  battle,
  otherRoom,
  livekitUrl,
  viewToken,
  isHost,
}: {
  roomId: string;
  hostId: string | undefined;
  mySide: "A" | "B";
  battle: NonNullable<PkBattleRow>["battle"];
  otherRoom: NonNullable<NonNullable<PkBattleRow>["otherRoom"]>;
  livekitUrl: string;
  viewToken: string | null;
  isHost: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [giftOpen, setGiftOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!battle.endsAt) return;
    const endsAt = new Date(battle.endsAt).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [battle.endsAt]);

  const endMutation = useMutation({
    mutationFn: () => endPkBattle({ data: { battleId: battle.id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pkBattle", roomId] }),
  });

  const myScore = mySide === "A" ? battle.scoreA : battle.scoreB;
  const otherScore = mySide === "A" ? battle.scoreB : battle.scoreA;
  const total = myScore + otherScore || 1;

  return (
    <>
      <div className="absolute inset-x-0 top-0 z-30 h-2/5">
        <OpponentFeed livekitUrl={livekitUrl} token={viewToken} hostName={otherRoom.host?.name} />
      </div>
      <div className="absolute inset-x-0 top-0 z-40 flex flex-col items-center gap-1 p-3">
        <div className="flex w-full max-w-xs items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-md">
          <span className="text-xs font-bold text-white">{myScore}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full bg-brand-coral transition-all"
              style={{ width: `${(myScore / total) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-white">{otherScore}</span>
        </div>
        {secondsLeft > 0 && (
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
            {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
          </span>
        )}
      </div>
      {isHost && (
        <button
          onClick={() => endMutation.mutate()}
          aria-label={t("live.pkEnd")}
          className="absolute end-3 top-[calc(40%+8px)] z-40 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white press-scale"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {hostId && (
        <button
          onClick={() => setGiftOpen(true)}
          className="absolute bottom-6 start-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand-coral px-4 py-2.5 text-xs font-bold text-white shadow-pop-coral press-scale"
        >
          <GiftIcon className="h-4 w-4" /> {t("live.pkSendGift")}
        </button>
      )}
      <PkGiftSheet open={giftOpen} onOpenChange={setGiftOpen} roomId={roomId} toUserId={hostId} />
    </>
  );
}

// A lightweight, subscribe-only second LiveKit connection to the paired room, so this room's
// screen can show the opposing host's live video alongside its own — this app has no server-side
// compositing/egress, so the split-screen is assembled client-side out of two real connections
// instead. Deliberately not another <LiveKitRoom>/useTracks tree (that would need a second nested
// room-context provider); a bare Room connection + manual track.attach() is simpler for a single
// read-only video tile.
function OpponentFeed({
  livekitUrl,
  token,
  hostName,
}: {
  livekitUrl: string;
  token: string | null;
  hostName: string | undefined;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!token) return;
    const room = new Room();
    let disposed = false;

    room
      .connect(livekitUrl, token)
      .then(() => {
        if (disposed) return;
        room.remoteParticipants.forEach((participant) => {
          participant.videoTrackPublications.forEach((pub) => {
            if (pub.track && videoRef.current) pub.track.attach(videoRef.current);
          });
        });
      })
      .catch(() => {});

    const onTrackSubscribed = (track: import("livekit-client").RemoteTrack) => {
      if (track.kind === Track.Kind.Video && videoRef.current) track.attach(videoRef.current);
    };
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);

    return () => {
      disposed = true;
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.disconnect();
    };
  }, [livekitUrl, token]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-900">
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />
      {hostName && (
        <span className="absolute bottom-2 start-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
          {hostName}
        </span>
      )}
    </div>
  );
}

function PkGiftSheet({
  open,
  onOpenChange,
  roomId,
  toUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  toUserId: string | undefined;
}) {
  const { t } = useTranslation();
  const { data: catalog } = useQuery({
    queryKey: ["giftCatalog"],
    queryFn: () => listGiftCatalog(),
    enabled: open,
  });

  const giftMutation = useMutation({
    mutationFn: (giftId: string) => sendGift({ data: { toUserId: toUserId!, giftId, roomId } }),
    onSuccess: () => onOpenChange(false),
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>{t("live.pkSendGift")}</SheetTitle>
        </SheetHeader>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {catalog?.map((g) => (
            <button
              key={g.id}
              onClick={() => giftMutation.mutate(g.id)}
              disabled={giftMutation.isPending || !toUserId}
              className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card p-3 press-scale disabled:opacity-60"
            >
              <span className="text-2xl">{g.emoji}</span>
              <span className="font-mono text-xs text-accent">{g.coins}</span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
