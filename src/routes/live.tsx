import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Radio, Users, AlertCircle } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listLiveRooms, startRoom, isLiveConfigured } from "@/functions/live";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/live")({
  component: LivePage,
});

const roomTypes = ["set", "battle", "acoustic"] as const;

function LivePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<(typeof roomTypes)[number]>("set");

  const { data: configured } = useQuery({
    queryKey: ["liveConfigured"],
    queryFn: () => isLiveConfigured(),
  });
  const { data: rooms } = useQuery({
    queryKey: ["liveRooms"],
    queryFn: () => listLiveRooms(),
    refetchInterval: 10_000,
  });

  const startMutation = useMutation({
    mutationFn: () => startRoom({ data: { title: title || t("live.defaultSessionTitle"), type } }),
    onSuccess: (res) => {
      sessionStorage.setItem(
        `sona-live-host-${res.room.id}`,
        JSON.stringify({ token: res.token, livekitUrl: res.livekitUrl }),
      );
      setGoLiveOpen(false);
      navigate({ to: "/live/$roomId", params: { roomId: res.room.id } });
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary animate-pulse-glow" />
            {t("live.title")}
          </h1>
          <button
            onClick={() => setGoLiveOpen(true)}
            className="rounded-full gradient-neon px-4 py-1.5 text-xs font-bold text-white glow-pink"
          >
            {t("live.goLive")}
          </button>
        </div>

        {configured === false && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-accent/40 bg-accent/5 p-3 text-xs text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            {t("live.notConfigured")}
          </div>
        )}

        {rooms?.length === 0 && (
          <p className="mt-6 text-center text-sm text-muted-foreground">{t("live.noOneLive")}</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          {rooms?.map((r, i) => (
            <button
              key={r.id}
              onClick={() => navigate({ to: "/live/$roomId", params: { roomId: r.id } })}
              className="relative aspect-[3/4] overflow-hidden rounded-2xl text-start"
            >
              <PostCoverBg hue={(i * 60 + 280) % 360} seed={r.id} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/40" />
              <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-white animate-pulse-glow">
                {t("common.live")}
              </span>
              <div className="absolute inset-x-0 bottom-0 p-3">
                <div className="flex items-center gap-2">
                  <img
                    src={r.host.avatarUrl}
                    className="h-8 w-8 rounded-full border-2 border-white"
                    alt=""
                  />
                  <div>
                    <p className="text-sm font-bold text-white">{r.host.name}</p>
                    <p className="text-[10px] text-white/80 capitalize">
                      {t(`live.${r.type}`, { defaultValue: r.type })}
                    </p>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Dialog open={goLiveOpen} onOpenChange={setGoLiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("live.goLive")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("live.sessionAbout")}
              className="input"
            />
            <div className="grid grid-cols-3 gap-2">
              {roomTypes.map((rt) => (
                <button
                  key={rt}
                  onClick={() => setType(rt)}
                  className={`rounded-full px-3 py-2 text-xs font-semibold capitalize ${
                    type === rt
                      ? "gradient-neon text-white"
                      : "border border-border bg-card/60 text-muted-foreground"
                  }`}
                >
                  {t(`live.${rt}`)}
                </button>
              ))}
            </div>
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-full gradient-neon py-2.5 text-sm font-bold text-white glow-pink disabled:opacity-60"
            >
              <Users className="h-4 w-4" />{" "}
              {startMutation.isPending ? t("live.starting") : t("live.startStreaming")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <style>{`.input { width: 100%; border-radius: 12px; background: var(--color-input); padding: 10px 12px; font-size: 14px; outline: none; border: 1px solid var(--color-border); }`}</style>
    </AppShell>
  );
}
