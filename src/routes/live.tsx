import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Radio, Users, AlertCircle } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { EmptyState } from "@/components/EmptyState";
import { Segmented } from "@/components/Segmented";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listLiveRooms, startRoom, isLiveConfigured } from "@/functions/live";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/live")({
  component: LivePage,
});

const roomTypes = ["set", "battle", "acoustic"] as const;
const staggerClasses = [
  "stagger-1",
  "stagger-2",
  "stagger-3",
  "stagger-4",
  "stagger-5",
  "stagger-6",
];

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
        JSON.stringify({
          token: res.token,
          livekitUrl: res.livekitUrl,
          type: res.room.type,
          host: null,
        }),
      );
      setGoLiveOpen(false);
      navigate({ to: "/live/$roomId", params: { roomId: res.room.id } });
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <AppShell width="wide">
      <TopBar />
      <div className="px-4 pb-8 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="page-title">{t("live.title")}</h1>
          {/* Only once there are rooms: on an empty screen the centred action is the one. */}
          {!!rooms?.length && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setGoLiveOpen(true)}
              className="flex h-10 items-center gap-2 rounded-xl bg-brand-coral px-4 text-sm font-bold text-white shadow-pop-coral transition-[filter] hover:brightness-110"
            >
              <span className="h-2 w-2 rounded-full bg-white" />
              {t("live.goLive")}
            </motion.button>
          )}
        </div>

        {configured === false && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            {t("live.notConfigured")}
          </div>
        )}

        {rooms?.length === 0 && (
          <EmptyState
            icon={Radio}
            title={t("live.noOneLive")}
            className="mt-10"
            action={
              <button
                onClick={() => setGoLiveOpen(true)}
                className="flex h-12 items-center gap-2 rounded-xl bg-brand-coral px-6 text-sm font-bold text-white shadow-pop-coral transition-[filter] hover:brightness-110 press-scale"
              >
                {t("live.goLive")}
              </button>
            }
          />
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {rooms?.map((r, i) => (
            <motion.button
              key={r.id}
              whileTap={{ scale: 0.96 }}
              whileHover={{ y: -3 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
              onClick={() => navigate({ to: "/live/$roomId", params: { roomId: r.id } })}
              className={`relative aspect-[3/4] overflow-hidden rounded-2xl text-start shadow-pop animate-fade-up ${staggerClasses[i % 6]}`}
            >
              <PostCoverBg hue={(i * 60 + 280) % 360} seed={r.id} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/40" />
              <span className="absolute start-2 top-2 flex items-center gap-1 rounded-md bg-brand-coral px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ring-pulse rounded-full bg-white" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                </span>
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
                    <p className="text-xs text-white/80 capitalize">
                      {t(`live.${r.type}`, { defaultValue: r.type })}
                    </p>
                  </div>
                </div>
              </div>
            </motion.button>
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
            <Segmented
              value={type}
              onChange={setType}
              options={roomTypes.map((rt) => ({ value: rt, label: t(`live.${rt}`) }))}
            />
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-coral text-sm font-bold text-white shadow-pop-coral press-scale disabled:opacity-60"
            >
              <Users className="h-4 w-4" />{" "}
              {startMutation.isPending ? t("live.starting") : t("live.startStreaming")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}
