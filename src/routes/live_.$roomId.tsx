import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { ArrowLeft, Radio } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { joinRoom, endRoom } from "@/functions/live";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/live_/$roomId")({
  component: LiveRoomPage,
});

type Session = { token: string; livekitUrl: string; isHost: boolean };

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
      setSession({ token: parsed.token, livekitUrl: parsed.livekitUrl, isHost: true });
      return;
    }
    joinRoom({ data: { roomId } })
      .then((res) => setSession({ token: res.token, livekitUrl: res.livekitUrl!, isHost: false }))
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
            className="rounded-full gradient-neon px-5 py-2 text-sm font-semibold text-white glow-pink"
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

  return (
    <AppShell hideNav>
      <div className="relative h-screen">
        <LiveKitRoom
          serverUrl={session.livekitUrl}
          token={session.token}
          connect
          video={session.isHost}
          audio={session.isHost}
          data-lk-theme="default"
          style={{ height: "100%" }}
          onDisconnected={() => navigate({ to: "/live" })}
        >
          <VideoConference />
        </LiveKitRoom>
        {session.isHost && (
          <button
            onClick={() => endMutation.mutate()}
            className="absolute right-3 top-3 z-50 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white"
          >
            {t("live.endLive")}
          </button>
        )}
      </div>
    </AppShell>
  );
}
