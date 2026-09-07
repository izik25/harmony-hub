import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LiveKitRoom, VideoConference, useParticipants } from "@livekit/components-react";
import "@livekit/components-styles";
import { ArrowLeft, Radio, Swords } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { joinRoom, endRoom } from "@/functions/live";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/live_/$roomId")({
  component: LiveRoomPage,
});

type Role = "host" | "opponent" | "viewer";
type UserBrief = { id: string; name: string; handle: string; avatarUrl: string };
type Session = {
  token: string;
  livekitUrl: string;
  role: Role;
  type: string;
  host: UserBrief | null;
  opponent: UserBrief | null;
};

function LiveRoomPage() {
  const { t } = useTranslation();
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        opponent: parsed.opponent ?? null,
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
          opponent: res.opponent ?? null,
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
          {session.type === "battle" && (session.host || session.opponent) && (
            <BattleHeader host={session.host} opponent={session.opponent} />
          )}
          <VideoConference />
        </LiveKitRoom>
        {session.role === "host" && (
          <button
            onClick={() => endMutation.mutate()}
            className="absolute right-3 top-3 z-50 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white shadow-pop-lg press-scale"
          >
            {t("live.endLive")}
          </button>
        )}
      </div>
    </AppShell>
  );
}

// Renders inside <LiveKitRoom> (needs the room context for useParticipants) to show who's meant
// to be dueting and whether the opponent has actually connected yet — the invite alone doesn't
// tell us that, only the live participant list does.
function BattleHeader({ host, opponent }: { host: UserBrief | null; opponent: UserBrief | null }) {
  const { t } = useTranslation();
  const participants = useParticipants();
  const identities = new Set(participants.map((p) => p.identity));

  return (
    <div className="absolute inset-x-0 top-3 z-40 flex justify-center px-3">
      <div className="flex items-center gap-3 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-md">
        <BattleSide user={host} connected={!!host && identities.has(host.id)} align="end" />
        <Swords className="h-4 w-4 shrink-0 text-brand-gold" />
        {opponent ? (
          <BattleSide user={opponent} connected={identities.has(opponent.id)} align="start" />
        ) : (
          <span className="text-xs text-white/70">{t("live.waitingForOpponent")}</span>
        )}
      </div>
    </div>
  );
}

function BattleSide({
  user,
  connected,
  align,
}: {
  user: UserBrief | null;
  connected: boolean;
  align: "start" | "end";
}) {
  if (!user) return null;
  return (
    <div className={`flex items-center gap-1.5 ${align === "end" ? "flex-row-reverse" : ""}`}>
      <div className="relative">
        <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-black/60 ${
            connected ? "bg-brand-teal" : "bg-white/30"
          }`}
        />
      </div>
      <span className="max-w-20 truncate text-xs font-semibold text-white">{user.name}</span>
    </div>
  );
}
