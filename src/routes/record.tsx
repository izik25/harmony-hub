import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Mic,
  Music2,
  Wand2,
  Sliders,
  Save,
  Send,
  Play,
  Pause,
  Square,
  Search,
  X,
  Check,
  Loader2,
} from "lucide-react";
import i18n, { translateServerError } from "@/lib/i18n";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { uploadMedia } from "@/functions/uploads";
import { createDraft } from "@/functions/posts";
import { listKaraokeTracks } from "@/functions/karaoke";
import { processRecording } from "@/lib/mix-recording";

export const Route = createFileRoute("/record")({
  component: RecordPage,
});

type KaraokeTrack = Awaited<ReturnType<typeof listKaraokeTracks>>[number];

const BAR_COUNT = 48;

function useMicLevels(active: boolean) {
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(6));
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;
    let ctx: AudioContext | undefined;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        source.connect(analyser);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const bucket = Math.floor(data.length / BAR_COUNT) || 1;
          const next = Array.from({ length: BAR_COUNT }, (_, i) => {
            const v = data[i * bucket] ?? 0;
            return 6 + (v / 255) * 60;
          });
          setLevels(next);
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => toast.error(i18n.t("record.micDenied")));

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctx?.close();
      setLevels(Array(BAR_COUNT).fill(6));
    };
  }, [active]);

  return { levels, stream: streamRef };
}

type Phase = "idle" | "recording" | "paused" | "finished";

function RecordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("idle");
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [processing, setProcessing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [autotune, setAutotune] = useState(60);
  const [pitch, setPitch] = useState(0);
  const [speed, setSpeed] = useState(100);
  const [reverb, setReverb] = useState(30);
  const [karaokeOpen, setKaraokeOpen] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<KaraokeTrack | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Array<BlobPart>>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const recording = phase === "recording";
  const { levels, stream } = useMicLevels(phase === "recording" || phase === "paused");

  useEffect(() => {
    if (phase === "recording") {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [phase]);

  useEffect(() => {
    if (phase !== "recording") return;

    // Resuming a paused take: same recorder, same chunk buffer — just pick back up.
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      videoRef.current?.play().catch(() => {});
      return;
    }

    // Starting a fresh take: wait for the mic stream to be ready, then create a new recorder.
    // The mic is recorded on its own, clean — the karaoke backing track (if any) gets blended
    // in afterward via an offline render (see finishRecording), not mixed live while recording.
    let cancelled = false;
    const waitForStream = setInterval(() => {
      if (cancelled) return clearInterval(waitForStream);
      if (stream.current) {
        clearInterval(waitForStream);
        chunksRef.current = [];
        if (videoRef.current) {
          videoRef.current.currentTime = 0;
          videoRef.current.play().catch(() => {});
        }
        const recorder = new MediaRecorder(stream.current);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          const rawBlob = new Blob(chunksRef.current, { type: "audio/webm" });
          setProcessing(true);
          // processRecording already time-boxes its own network fetch and render internally;
          // this outer race is a last-resort safety net so nothing — however unexpected — can
          // ever leave Save disabled forever.
          const withOverallTimeout = Promise.race([
            processRecording(rawBlob, selectedTrack?.videoUrl),
            new Promise<Blob>((_, reject) =>
              setTimeout(() => reject(new Error("processing timed out")), 30_000),
            ),
          ]);
          withOverallTimeout
            .then(setRecordedBlob)
            .catch((err) => {
              console.error(err);
              toast.error(t("record.processFailed"));
              setRecordedBlob(rawBlob); // keep the take rather than losing it
            })
            .finally(() => setProcessing(false));
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
      }
    }, 100);
    return () => {
      cancelled = true;
      clearInterval(waitForStream);
    };
  }, [phase, stream, selectedTrack, t]);

  const startOrResume = () => {
    if (phase !== "paused") {
      setRecordedBlob(null);
      setSeconds(0);
    }
    setPhase("recording");
  };

  const pauseRecording = () => {
    mediaRecorderRef.current?.pause();
    videoRef.current?.pause();
    setPhase("paused");
  };

  const finishRecording = () => {
    mediaRecorderRef.current?.stop();
    videoRef.current?.pause();
    setPhase("finished");
  };

  const togglePreview = () => {
    if (!recordedBlob) return;
    if (!audioElRef.current) {
      audioElRef.current = new Audio(URL.createObjectURL(recordedBlob));
      audioElRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioElRef.current.pause();
      setPlaying(false);
    } else {
      audioElRef.current.play();
      setPlaying(true);
    }
  };

  const finishMutation = useMutation({
    mutationFn: async (next: "studio" | "upload" | "upload-comp") => {
      if (!recordedBlob) throw new Error(i18n.t("record.recordFirst"));
      const formData = new FormData();
      const ext = recordedBlob.type.includes("wav") ? "wav" : "webm";
      formData.append("file", recordedBlob, `recording-${Date.now()}.${ext}`);
      const { url } = await uploadMedia({ data: formData });
      const draft = await createDraft({
        data: {
          audioUrl: url,
          title: selectedTrack
            ? [selectedTrack.artist, selectedTrack.title].filter(Boolean).join(" — ")
            : undefined,
        },
      });
      return { draft, next };
    },
    onSuccess: ({ draft, next }) => {
      if (next === "studio") navigate({ to: "/studio", search: { draftId: draft.id } });
      else if (next === "upload") navigate({ to: "/upload", search: { draftId: draft.id } });
      else navigate({ to: "/upload", search: { draftId: draft.id, forCompetition: 1 } });
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">{t("record.title")}</h1>
          <Link to="/upload" search={{}} className="text-xs text-accent underline">
            {t("record.skipUpload")}
          </Link>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => setKaraokeOpen(true)}
            className="flex flex-1 items-center gap-3 rounded-2xl border border-border bg-card/60 p-3 text-start"
          >
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl gradient-neon">
              <Music2 className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="line-clamp-1 text-sm font-semibold">
                {selectedTrack
                  ? [selectedTrack.artist, selectedTrack.title].filter(Boolean).join(" — ")
                  : t("record.karaoke")}
              </p>
              <p className="line-clamp-1 text-xs text-muted-foreground">
                {selectedTrack ? t("record.changeTrack") : t("record.karaokeDesc")}
              </p>
            </div>
          </button>
          {selectedTrack && (
            <button
              onClick={() => setSelectedTrack(null)}
              aria-label={t("record.clearTrack")}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card/60"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-6 rounded-3xl border border-border bg-card/50 p-4">
          <div
            className={`relative overflow-hidden rounded-2xl bg-background/70 ${selectedTrack ? "aspect-video" : "h-40"}`}
          >
            {selectedTrack ? (
              <video
                ref={videoRef}
                src={selectedTrack.videoUrl}
                className="h-full w-full object-cover"
                playsInline
                muted={false}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-around px-3">
                {levels.map((h, i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full transition-[height] duration-75"
                    style={{ height: h, background: `hsl(${300 + ((i * 3) % 60)} 90% 60%)` }}
                  />
                ))}
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center gap-4">
              {phase === "paused" ? (
                <>
                  <button
                    onClick={startOrResume}
                    className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-full gradient-neon glow-pink"
                  >
                    <Mic className="h-6 w-6 text-white" />
                    <span className="text-[9px] font-semibold text-white">
                      {t("record.continueRecording")}
                    </span>
                  </button>
                  <button
                    onClick={finishRecording}
                    className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-full border border-accent bg-accent/20"
                  >
                    <Check className="h-6 w-6 text-accent" />
                    <span className="text-[9px] font-semibold text-accent">
                      {t("record.finishRecording")}
                    </span>
                  </button>
                </>
              ) : (
                <button
                  onClick={recording ? pauseRecording : startOrResume}
                  className={`grid h-20 w-20 place-items-center rounded-full gradient-neon glow-pink ${recording ? "animate-pulse-glow" : ""} ${selectedTrack ? "opacity-90" : ""}`}
                >
                  {recording ? (
                    <Square className="h-8 w-8 text-white" />
                  ) : (
                    <Mic className="h-9 w-9 text-white" />
                  )}
                </button>
              )}
            </div>
          </div>

          {selectedTrack && (
            <div className="mt-3 flex items-center justify-around">
              {levels.map((h, i) => (
                <span
                  key={i}
                  className="w-0.5 rounded-full transition-[height] duration-75"
                  style={{
                    height: Math.min(h, 24),
                    background: `hsl(${300 + ((i * 3) % 60)} 90% 60%)`,
                  }}
                />
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>00:00</span>
            <span className="flex items-center gap-1.5">
              {processing && <Loader2 className="h-3 w-3 animate-spin" />}
              {processing
                ? t("record.processing")
                : phase === "recording"
                  ? t("record.rec")
                  : phase === "paused"
                    ? t("record.paused")
                    : recordedBlob
                      ? t("record.ready")
                      : t("record.idle")}{" "}
              {mm}:{ss}
            </span>
            <span>—</span>
          </div>
        </div>

        <section className="mt-6 rounded-3xl border border-border bg-card/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              {t("record.aiVocalNote")}
            </h2>
          </div>
          <Knob label={t("record.autotune")} value={autotune} onChange={setAutotune} suffix="%" />
          <Knob
            label={t("record.pitch")}
            value={pitch}
            onChange={setPitch}
            min={-12}
            max={12}
            suffix=" st"
          />
          <Knob
            label={t("record.speed")}
            value={speed}
            onChange={setSpeed}
            min={50}
            max={150}
            suffix="%"
          />
          <Knob label={t("record.reverb")} value={reverb} onChange={setReverb} suffix="%" />

          <Link
            to="/studio"
            search={{ autotune, pitch, speed, reverb }}
            className="mt-3 flex items-center justify-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-semibold text-accent"
          >
            <Sliders className="h-4 w-4" /> {t("record.openStudio")}
          </Link>
        </section>

        <div className="mt-6 grid grid-cols-4 gap-2">
          <BigAction
            icon={playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            label={t("common.preview")}
            onClick={togglePreview}
            disabled={!recordedBlob}
          />
          <BigAction
            icon={<Save className="h-5 w-5" />}
            label={t("common.save")}
            onClick={() => finishMutation.mutate("studio")}
            disabled={!recordedBlob || finishMutation.isPending}
          />
          <BigAction
            icon={<Send className="h-5 w-5" />}
            label={t("common.publish")}
            primary
            onClick={() => finishMutation.mutate("upload")}
            disabled={!recordedBlob || finishMutation.isPending}
          />
          <BigAction
            icon={<Send className="h-5 w-5" />}
            label={t("record.sendComp")}
            onClick={() => finishMutation.mutate("upload-comp")}
            disabled={!recordedBlob || finishMutation.isPending}
          />
        </div>
      </div>

      <KaraokePickerSheet
        open={karaokeOpen}
        onClose={() => setKaraokeOpen(false)}
        onSelect={(track) => {
          setSelectedTrack(track);
          setKaraokeOpen(false);
        }}
      />
    </AppShell>
  );
}

function KaraokePickerSheet({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (track: KaraokeTrack) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { data: tracks } = useQuery({
    queryKey: ["karaokeTracks", query],
    queryFn: () => listKaraokeTracks({ data: { query } }),
    enabled: open,
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="flex h-[70vh] flex-col rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>{t("record.karaoke")}</SheetTitle>
        </SheetHeader>
        <label className="mt-2 flex items-center gap-2 rounded-full bg-muted/60 px-4 py-2.5 ring-1 ring-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("record.karaokeSearchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
          {tracks?.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <p>{t("record.noKaraokeTracks")}</p>
              <p className="mt-2 text-[11px]">{t("record.noKaraokeTracksHint")}</p>
            </div>
          )}
          {tracks?.map((track) => (
            <button
              key={track.id}
              onClick={() => onSelect(track)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card/60 p-3 text-start hover:border-primary/50"
            >
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl gradient-neon">
                <Music2 className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="line-clamp-1 text-sm font-semibold">{track.title}</p>
                {track.artist && (
                  <p className="line-clamp-1 text-xs text-muted-foreground">{track.artist}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Knob({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  suffix = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-foreground/90">{label}</span>
        <span className="font-mono text-accent">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}
function BigAction({
  icon,
  label,
  primary,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-[11px] font-semibold disabled:opacity-40 ${primary ? "gradient-neon border-transparent text-white glow-pink" : "border-border bg-card/60 text-foreground/90"}`}
    >
      {icon}
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}
