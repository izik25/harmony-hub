import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wand2, Play, Pause, Mic, Square, Loader2, Check, X, Scissors } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { smartUploadMedia } from "@/lib/blob-upload";
import { updateDraftAudio } from "@/functions/posts";
import { processRecording } from "@/lib/mix-recording";
import { replaceSegment } from "@/lib/audio-splice";
import { translateServerError } from "@/lib/i18n";

// Same idea as record.tsx's MIC_CONSTRAINTS: AEC off (it forces a different, speaker-routing
// audio session on Android), NS/AGC on, mono, 48kHz — kept consistent so a re-recorded section
// doesn't sound like it came from a different mic setup than the rest of the take.
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: { ideal: 48000 },
  channelCount: { ideal: 1 },
};

// How far before the marked start point playback cues from, so punching in lands where the
// original phrase actually picks up instead of starting cold with no sense of tempo/pitch.
const PREROLL_SECONDS = 2;

function formatTime(s: number) {
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  return `${m}:${ss}`;
}

type Phase = "marking" | "cueing" | "recording" | "splicing" | "reviewing";

export function FixSectionEditor({
  draftId,
  rawVocalUrl,
  backingTrackUrl,
  vocalGain,
  backingGain,
  // Seeds the start marker from wherever the caller was already listening (the main Studio
  // scrubber's position), expressed as a 0-1 fraction of that scrubber's own duration rather than
  // raw seconds — this raw take and the mixed audioUrl aren't guaranteed to be exactly the same
  // length (padding/trimming can drift them apart), so mapping proportionally is the only way a
  // position scrubbed to on the mixed track reliably lands on the same audible moment here. Lets
  // you scrub to the spot you want fixed, open this panel, and only have to mark the end instead
  // of re-finding the start from scratch.
  initialStartFraction,
  onSaved,
  onClose,
}: {
  draftId: string;
  rawVocalUrl: string;
  backingTrackUrl?: string | null;
  vocalGain: number;
  backingGain: number;
  initialStartFraction?: number;
  onSaved: (urls: { audioUrl: string; rawVocalUrl: string }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("marking");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const backingRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Array<BlobPart>>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pendingBlobRef = useRef<Blob | null>(null);
  // Guards the timeupdate listener that watches for the pre-roll cue crossing `start` — without
  // it, a stray timeupdate firing after the phase has already moved on (e.g. user cancels mid-cue)
  // could kick off a recording nobody asked for anymore.
  const cueingRef = useRef(false);

  useEffect(() => {
    return () => {
      clearInterval(elapsedTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  };

  const markStart = () => {
    const t = currentTime;
    setStart(t);
    if (end != null && end <= t) setEnd(null);
  };

  const markEnd = () => {
    if (start == null) return;
    if (currentTime <= start) {
      toast.error(t("studio.fixInvalidRange"));
      return;
    }
    setEnd(currentTime);
  };

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const beginRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 128_000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setPhase("recording");
      setElapsed(0);
      elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      if (backingTrackUrl && backingRef.current && start != null) {
        backingRef.current.currentTime = start;
        backingRef.current.volume = 0.35;
        backingRef.current.play().catch(() => {});
      }
    } catch {
      toast.error(t("studio.fixMicDenied"));
      setPhase("marking");
    }
  };

  const startFix = async () => {
    if (start == null || end == null || end <= start) {
      toast.error(t("studio.fixInvalidRange"));
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    setPhase("cueing");
    cueingRef.current = true;
    audio.currentTime = Math.max(0, start - PREROLL_SECONDS);
    audio.play().catch(() => {
      cueingRef.current = false;
      beginRecording();
    });
  };

  // Fires continuously while the pre-roll cue plays; the moment playback reaches the marked start
  // point, pause the cue (it must be silent before the mic opens, or the old take bleeds straight
  // into the new take) and hand off to the actual recording.
  const handleCueTimeUpdate = () => {
    if (!cueingRef.current || start == null) return;
    const audio = audioRef.current;
    if (!audio || audio.currentTime < start - 0.05) return;
    cueingRef.current = false;
    audio.pause();
    beginRecording();
  };

  const stopRecording = () => {
    clearInterval(elapsedTimerRef.current);
    backingRef.current?.pause();
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.onstop = async () => {
      cleanupStream();
      const newBlob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = [];
      if (newBlob.size === 0 || start == null || end == null) {
        setPhase("marking");
        return;
      }
      setPhase("splicing");
      try {
        const baseBlob = await fetch(rawVocalUrl).then((r) => r.blob());
        const { blob } = await replaceSegment(baseBlob, start, end, newBlob);
        pendingBlobRef.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase("reviewing");
      } catch (err) {
        console.error(err);
        toast.error(t("studio.fixSpliceFailed"));
        setPhase("marking");
      }
    };
    recorder.stop();
  };

  const discardFix = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    pendingBlobRef.current = null;
    setPhase("marking");
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const raw = pendingBlobRef.current;
      if (!raw) throw new Error(t("studio.fixSaveFailed"));
      const mixed = await processRecording(raw, backingTrackUrl || undefined, {
        vocalGain,
        backingGain,
      });
      const [rawUp, mixedUp] = await Promise.all([
        smartUploadMedia(raw, `fix-raw-${Date.now()}.wav`),
        smartUploadMedia(mixed, `fix-mixed-${Date.now()}.wav`),
      ]);
      await updateDraftAudio({
        data: { id: draftId, audioUrl: mixedUp.url, rawVocalUrl: rawUp.url },
      });
      return { audioUrl: mixedUp.url, rawVocalUrl: rawUp.url };
    },
    onSuccess: (urls) => {
      toast.success(t("studio.fixSavedToast"));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      onSaved(urls);
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const cancelPanel = () => {
    clearInterval(elapsedTimerRef.current);
    audioRef.current?.pause();
    backingRef.current?.pause();
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    cleanupStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onClose();
  };

  const startFraction = start != null && duration > 0 ? start / duration : 0;
  const endFraction = end != null && duration > 0 ? end / duration : startFraction;
  const canPunchIn = start != null && end != null && end > start;

  return (
    <section className="mt-5 rounded-3xl border border-accent/40 bg-accent/5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-accent">
          <Scissors className="h-4 w-4" /> {t("studio.fixSection")}
        </h2>
        <button
          onClick={cancelPanel}
          aria-label={t("studio.fixCancel")}
          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-black/5"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {backingTrackUrl && (
        <video
          ref={backingRef}
          src={backingTrackUrl}
          className="hidden"
          playsInline
          muted={false}
        />
      )}
      <audio
        ref={audioRef}
        src={rawVocalUrl}
        onLoadedMetadata={(e) => {
          const dur = e.currentTarget.duration || 0;
          setDuration(dur);
          if (initialStartFraction != null) {
            const seeded = Math.min(Math.max(initialStartFraction, 0), 1) * dur;
            e.currentTarget.currentTime = seeded;
            setCurrentTime(seeded);
            setStart(seeded);
          }
        }}
        onTimeUpdate={(e) => {
          setCurrentTime(e.currentTarget.currentTime);
          handleCueTimeUpdate();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      <AnimatePresence mode="wait">
        {(phase === "marking" || phase === "cueing") && (
          <motion.div
            key="marking"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <p className="mt-1 text-xs text-muted-foreground">{t("studio.fixSectionDesc")}</p>

            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={togglePlay}
                disabled={phase === "cueing" || duration === 0}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-coral text-white shadow-pop-coral disabled:opacity-50"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <div dir="ltr" className="relative flex-1">
                <div className="relative h-2 w-full rounded-full bg-muted/60">
                  {canPunchIn ? (
                    <div
                      className="absolute top-0 h-2 rounded-full bg-destructive/40"
                      style={{
                        left: `${startFraction * 100}%`,
                        width: `${Math.max(0, endFraction - startFraction) * 100}%`,
                      }}
                    />
                  ) : (
                    start != null && (
                      // A pin marking the start point on its own — e.g. right after opening this
                      // panel already scrubbed to it — so it stays visible while you scrub ahead
                      // to find the end, instead of only appearing once both ends are marked.
                      <div
                        className="absolute top-0 h-2 w-1 rounded-full bg-destructive"
                        style={{ left: `${startFraction * 100}%` }}
                      />
                    )
                  )}
                  <div
                    className="absolute top-0 h-2 rounded-full bg-primary/70"
                    style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.05}
                  value={currentTime}
                  disabled={phase === "cueing"}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (audioRef.current) audioRef.current.currentTime = v;
                    setCurrentTime(v);
                  }}
                  className="absolute inset-x-0 top-0 h-2 w-full cursor-pointer opacity-0"
                />
              </div>
              <span className="w-10 shrink-0 text-end text-[11px] font-mono text-muted-foreground">
                {formatTime(currentTime)}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={markStart}
                disabled={phase === "cueing" || duration === 0}
                className="press-scale flex-1 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {t("studio.fixMarkStart")}
              </button>
              <button
                onClick={markEnd}
                disabled={phase === "cueing" || start == null}
                className="press-scale flex-1 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {t("studio.fixMarkEnd")}
              </button>
            </div>

            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {canPunchIn
                ? t("studio.fixSelected", {
                    start: formatTime(start!),
                    end: formatTime(end!),
                    dur: formatTime(end! - start!),
                  })
                : start != null
                  ? t("studio.fixStartMarked", { start: formatTime(start) })
                  : t("studio.fixNoSelection")}
            </p>

            <motion.button
              onClick={startFix}
              disabled={!canPunchIn || phase === "cueing"}
              whileTap={{ scale: 0.97 }}
              className="press-scale mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-brand-coral py-2.5 text-sm font-bold text-white shadow-pop-coral disabled:opacity-40"
            >
              {phase === "cueing" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("studio.fixCueing")}
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" /> {t("studio.fixStartOver")}
                </>
              )}
            </motion.button>
          </motion.div>
        )}

        {phase === "recording" && (
          <motion.div
            key="recording"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-3 flex flex-col items-center gap-3"
          >
            <span className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-xs font-bold text-destructive">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ring-pulse rounded-full bg-destructive" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
              </span>
              {t("studio.fixRecording")} {formatTime(elapsed)}
            </span>
            <motion.button
              onClick={stopRecording}
              whileTap={{ scale: 0.92 }}
              className="grid h-14 w-14 place-items-center rounded-full bg-brand-coral text-white shadow-pop-coral"
              aria-label={t("studio.fixStop")}
            >
              <Square className="h-5 w-5" />
            </motion.button>
          </motion.div>
        )}

        {phase === "splicing" && (
          <motion.div
            key="splicing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-4 flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" /> {t("studio.fixSplicing")}
          </motion.div>
        )}

        {phase === "reviewing" && previewUrl && (
          <motion.div
            key="reviewing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-3"
          >
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              {t("studio.fixPreviewTitle")}
            </p>
            <audio controls src={previewUrl} className="w-full" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={discardFix}
                disabled={saveMutation.isPending}
                className="press-scale rounded-full border border-border bg-card px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {t("studio.fixDiscard")}
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="press-scale flex items-center justify-center gap-1.5 rounded-full bg-brand-coral px-3 py-2.5 text-sm font-bold text-white shadow-pop-coral disabled:opacity-50"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {t("studio.fixKeep")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function FixSectionToggle({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="press-scale mt-1 flex w-full items-center justify-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-semibold text-accent"
    >
      <Wand2 className="h-4 w-4" />
      {t("studio.fixSection")}
    </button>
  );
}
