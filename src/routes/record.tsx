import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mic, Music2, Search, X, Check, Pause, Loader2, Headphones, Scissors } from "lucide-react";
import i18n, { translateServerError } from "@/lib/i18n";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { smartUploadMedia } from "@/lib/blob-upload";
import { createDraft } from "@/functions/posts";
import { listKaraokeTracks } from "@/functions/karaoke";
import { processRecording } from "@/lib/mix-recording";
import { commitCheckpoint, trimCheckpoint } from "@/lib/audio-splice";

export const Route = createFileRoute("/record")({
  component: RecordPage,
});

type KaraokeTrack = Awaited<ReturnType<typeof listKaraokeTracks>>[number];

const BAR_COUNT = 48;
// Starting balance for the initial auto-mix — matches the Mix Balance defaults in studio.tsx, a
// touch under the vocal / a touch over the backing track so the take doesn't drown out the
// instrumental out of the gate. The user re-balances (and hears the result) from Studio, which
// now owns this entirely; record.tsx's only job is to get a take onto the Studio screen fast.
const DEFAULT_VOCAL_GAIN = 1.25;
const DEFAULT_BACKING_GAIN = 0.75;
// Studio-style cue: how loud the mic is fed back into the monitor tap, relative to the raw
// signal. Kept under unity so a live "hear yourself" mix doesn't come in hotter than the
// backing track and isn't right at the edge of feedback if headphones seal imperfectly.
const MONITOR_GAIN = 0.8;

function useMicLevels(active: boolean, monitor: boolean) {
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(6));
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;
    let ctx: AudioContext | undefined;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 },
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        ctx = new AudioContext();
        ctxRef.current = ctx;
        // Chrome's autoplay policy can leave a freshly-created AudioContext "suspended" if the
        // mic permission prompt ate up the page's transient user-activation window (first-time
        // grants especially) — when that happens every node in the graph goes silent, including
        // the monitor tap below, with no visible sign anything's wrong. Resuming explicitly is
        // the standard fix and a harmless no-op if the context was already running.
        ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        source.connect(analyser);
        analyserRef.current = analyser;

        // Live monitor tap: routes the mic straight to the output (headphones) so you can hear
        // yourself over the backing track while recording, like a studio cue mix. This is a
        // separate node off the same source — it never touches what MediaRecorder captures, so
        // it can be toggled live without affecting the take being recorded.
        const monitorGain = ctx.createGain();
        monitorGain.gain.value = monitor ? MONITOR_GAIN : 0;
        source.connect(monitorGain);
        monitorGain.connect(ctx.destination);
        monitorGainRef.current = monitorGain;

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
      monitorGainRef.current = null;
      ctxRef.current = null;
      ctx?.close();
      setLevels(Array(BAR_COUNT).fill(6));
    };
    // monitor intentionally excluded: this effect opens the mic stream/AudioContext, which we
    // don't want to tear down and recreate (audible glitch) every time the toggle flips — the
    // separate effect below rides the gain node instead, using the initial value here only to
    // seed it correctly for whatever the toggle's state was when the stream opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Toggling monitoring shouldn't tear down and reopen the mic stream — just ride the gain
  // node up or down live. Also re-resumes the context on the way up: some browsers suspend an
  // inactive-tab or long-idle AudioContext on their own, and flipping the toggle back on is the
  // moment the user expects to actually hear themselves again.
  useEffect(() => {
    if (monitor) ctxRef.current?.resume().catch(() => {});
    if (monitorGainRef.current) {
      monitorGainRef.current.gain.value = monitor ? MONITOR_GAIN : 0;
    }
  }, [monitor]);

  return { levels, stream: streamRef };
}

function formatTime(s: number) {
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  return `${m}:${ss}`;
}

// Spaces the scrub bar's time markers so a short freestyle take and a five-minute one both end up
// with a readable handful of ticks instead of either one bare line or an illegible comb.
function pickTickInterval(totalSeconds: number): number {
  if (totalSeconds <= 15) return 2;
  if (totalSeconds <= 40) return 5;
  if (totalSeconds <= 90) return 10;
  if (totalSeconds <= 240) return 30;
  return 60;
}

type Phase = "idle" | "recording" | "paused" | "finished";

function RecordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [karaokeOpen, setKaraokeOpen] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<KaraokeTrack | null>(null);
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  // Rewind-and-punch-in: previewSeconds tracks the live drag position while the user is
  // scrubbing the timeline backward; cutConfirm holds the target once they release, gating the
  // "delete back to here and re-record?" dialog.
  const [previewSeconds, setPreviewSeconds] = useState<number | null>(null);
  const [cutConfirm, setCutConfirm] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Array<BlobPart>>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // Everything committed before the currently-live MediaRecorder segment — every pause, scrub
  // checkpoint, or confirmed cut folds the live segment into this (see audio-splice.ts) and
  // throws the MediaRecorder instance away, rather than trying to pause/resume one continuous
  // recorder. That's what makes an arbitrary mid-recording cut possible: a WebM chunk stream can
  // only be decoded from its own start, so there's no way to snip a "resumed" recorder's stream
  // in the middle — but decoding, slicing and re-concatenating whole takes works from any blob.
  const baseBlobRef = useRef<Blob | null>(null);
  // Resolves once a live recorder's audio has been folded into baseBlobRef; awaited before
  // anything (finish, a new scrub) reads baseBlobRef so it never races an in-flight checkpoint.
  const checkpointPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const checkpointResolveRef = useRef<(() => void) | null>(null);
  const stopModeRef = useRef<"checkpoint" | "finish">("checkpoint");
  // Whether recording was actively running when a scrub gesture began, so releasing without a
  // real rewind (or answering "no" to the cut prompt) knows whether to resume or stay paused.
  const wasRecordingRef = useRef(false);
  const recording = phase === "recording";
  const { levels, stream } = useMicLevels(
    phase === "recording" || phase === "paused",
    monitorEnabled,
  );

  // Remember the monitor preference across visits, same as any other studio setting.
  useEffect(() => {
    setMonitorEnabled(localStorage.getItem("hh:monitorEnabled") === "1");
  }, []);

  const toggleMonitor = () => {
    setMonitorEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("hh:monitorEnabled", next ? "1" : "0");
      if (next) toast.info(t("record.monitorFeedbackWarning"));
      return next;
    });
  };

  useEffect(() => {
    if (phase === "recording") {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [phase]);

  // On a phone especially, the backing track plays out of the speaker right next to the mic and
  // bleeds straight into the recording. Ducking playback while actively recording (still clearly
  // audible to follow along, just quieter) cuts down how much of that bleed reaches the mic in
  // the first place — the noise gate in processRecording only cleans up what's left over.
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = phase === "recording" ? 0.35 : 1;
  }, [phase, selectedTrack]);

  // Turns a finished take straight into a Studio session: mixes the raw recording with whatever
  // karaoke backing was used (same offline pipeline as before), uploads both the mixed result and
  // the raw stem (so Studio's Mix Balance section can re-bake a different vocal/playback balance
  // later), creates the draft, and lands on Studio — no separate "Save" tap in between.
  const finishMutation = useMutation({
    mutationFn: async (rawBlob: Blob) => {
      let mixedBlob: Blob;
      try {
        mixedBlob = await Promise.race([
          processRecording(rawBlob, selectedTrack?.videoUrl, {
            vocalGain: DEFAULT_VOCAL_GAIN,
            backingGain: DEFAULT_BACKING_GAIN,
          }),
          new Promise<Blob>((_, reject) =>
            setTimeout(() => reject(new Error("processing timed out")), 30_000),
          ),
        ]);
      } catch (err) {
        console.error(err);
        toast.error(t("record.processFailed"));
        mixedBlob = rawBlob; // keep the take rather than losing it
      }

      const ext = mixedBlob.type.includes("wav") ? "wav" : "webm";
      // rawBlob is WAV whenever the take went through a rewind/cut checkpoint (see
      // audio-splice.ts) and plain WebM otherwise — name it to match what it actually is.
      const rawExt = rawBlob.type.includes("wav") ? "wav" : "webm";
      const [mixed, raw] = await Promise.all([
        smartUploadMedia(mixedBlob, `recording-${Date.now()}.${ext}`),
        smartUploadMedia(rawBlob, `recording-raw-${Date.now()}.${rawExt}`),
      ]);
      return createDraft({
        data: {
          audioUrl: mixed.url,
          rawVocalUrl: raw.url,
          backingTrackUrl: selectedTrack?.videoUrl,
          title: selectedTrack
            ? [selectedTrack.artist, selectedTrack.title].filter(Boolean).join(" — ")
            : undefined,
        },
      });
    },
    onSuccess: (draft) => navigate({ to: "/studio", search: { draftId: draft.id } }),
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  useEffect(() => {
    if (phase !== "recording") return;

    // Every entry into "recording" starts a brand-new MediaRecorder appended after whatever's
    // already in baseBlobRef — there's no browser-level pause()/resume() here (see baseBlobRef's
    // comment above for why). Wait for the mic stream to be ready, then create the recorder. The
    // mic is recorded on its own, clean — the karaoke backing track (if any) gets blended in
    // afterward via an offline render (finishMutation), not mixed live while recording.
    let cancelled = false;
    const waitForStream = setInterval(() => {
      if (cancelled) return clearInterval(waitForStream);
      if (stream.current) {
        clearInterval(waitForStream);
        chunksRef.current = [];
        if (videoRef.current) {
          // Only rewind the backing video to the top for a genuinely fresh take — resuming after
          // a pause/scrub checkpoint should carry on from wherever it already is.
          if (!baseBlobRef.current) videoRef.current.currentTime = 0;
          videoRef.current.play().catch(() => {});
        }
        // Explicit bitrate — MediaRecorder's default Opus encoding is conservative enough that
        // the raw capture itself can come out sounding thin/"voice memo"-like before any
        // cleanup even runs. 128kbps is comfortably high quality for a mono voice track.
        const recorder = new MediaRecorder(stream.current, { audioBitsPerSecond: 128_000 });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          const newBlob = new Blob(chunksRef.current, { type: "audio/webm" });
          chunksRef.current = [];
          const mode = stopModeRef.current;
          const resolveCheckpoint = checkpointResolveRef.current;
          checkpointResolveRef.current = null;

          if (mode === "finish") {
            if (baseBlobRef.current) {
              try {
                const { blob } = await commitCheckpoint(baseBlobRef.current, newBlob);
                finishMutation.mutate(blob);
              } catch (err) {
                console.error(err);
                finishMutation.mutate(newBlob); // keep the last segment rather than losing the take
              }
            } else {
              finishMutation.mutate(newBlob);
            }
            resolveCheckpoint?.();
            return;
          }

          // Checkpoint: fold whatever was just captured into the running base so a pause or a
          // scrub never loses audio, even though the MediaRecorder instance itself is discarded.
          if (newBlob.size > 0) {
            try {
              const { blob } = await commitCheckpoint(baseBlobRef.current, newBlob);
              baseBlobRef.current = blob;
            } catch (err) {
              console.error(err); // keep the previous checkpoint rather than losing the take
            }
          }
          resolveCheckpoint?.();
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
      }
    }, 100);
    return () => {
      cancelled = true;
      clearInterval(waitForStream);
    };
    // finishMutation intentionally excluded: this effect only sets up recording start/resume, and
    // onstop always reads the latest mutate function from the closure — including it here would
    // restart the whole recorder setup whenever unrelated state it depends on changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stream, selectedTrack, t]);

  const startOrResume = () => {
    if (phase !== "paused") {
      setSeconds(0);
      baseBlobRef.current = null; // a genuinely fresh take, not a continue-after-checkpoint
    }
    setPhase("recording");
  };

  // Stops the live recorder (if any) and folds its audio into baseBlobRef, in `mode`. Resolves
  // once that fold-in has finished — callers that need baseBlobRef to be current (finishing,
  // starting a new scrub) await this instead of racing the async decode/encode.
  const stopRecorder = (mode: "checkpoint" | "finish"): Promise<void> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return Promise.resolve();
    const promise = new Promise<void>((resolve) => {
      checkpointResolveRef.current = resolve;
    });
    stopModeRef.current = mode;
    recorder.stop();
    return promise;
  };

  const pauseRecording = () => {
    videoRef.current?.pause();
    checkpointPromiseRef.current = stopRecorder("checkpoint");
    setPhase("paused");
  };

  const finishRecording = async () => {
    videoRef.current?.pause();
    await checkpointPromiseRef.current;
    if (mediaRecorderRef.current?.state === "recording") {
      await stopRecorder("finish"); // onstop calls finishMutation.mutate itself
    } else if (baseBlobRef.current) {
      finishMutation.mutate(baseBlobRef.current);
    }
    setPhase("finished");
  };

  const resumeIfWasRecording = () => {
    if (wasRecordingRef.current) startOrResume();
  };

  // Drag start: freeze the timeline at its current length (stopping the 1s ticker by flipping to
  // "paused") and, if we were actively recording, checkpoint the in-flight segment so
  // baseBlobRef reflects "now" exactly — the point the user is about to rewind from.
  const handleScrubStart = () => {
    if (finishMutation.isPending || seconds < 1) return;
    wasRecordingRef.current = phase === "recording";
    setPreviewSeconds(seconds);
    if (wasRecordingRef.current) {
      videoRef.current?.pause();
      checkpointPromiseRef.current = stopRecorder("checkpoint");
      // Flips the 1s ticker off (it only runs while phase === "recording") so the timeline's
      // length stays put for the rest of the gesture instead of growing while the user drags.
      setPhase("paused");
    }
  };

  const handleScrubMove = (value: number) => {
    setPreviewSeconds(value);
    // Scrubs the karaoke video/lyrics along with the drag — seeing exactly what was on screen at
    // the point you're dragging to is a much clearer reference than a bare number.
    if (videoRef.current) videoRef.current.currentTime = value;
  };

  const handleScrubEnd = async (value: number) => {
    setPreviewSeconds(null);
    await checkpointPromiseRef.current;
    if (value >= seconds) {
      // No real rewind — a tap, or released right back where it started. Snap the video back to
      // "now" in case the drag scrubbed it away from that.
      if (videoRef.current) videoRef.current.currentTime = seconds;
      resumeIfWasRecording();
      return;
    }
    setCutConfirm(value);
  };

  const cancelCut = () => {
    setCutConfirm(null);
    if (videoRef.current) videoRef.current.currentTime = seconds;
    resumeIfWasRecording();
  };

  const confirmCut = async () => {
    const target = cutConfirm;
    setCutConfirm(null);
    if (target == null || !baseBlobRef.current) {
      resumeIfWasRecording();
      return;
    }
    try {
      const { blob, seconds: exact } = await trimCheckpoint(baseBlobRef.current, target);
      baseBlobRef.current = blob;
      setSeconds(Math.round(exact));
      if (videoRef.current) videoRef.current.currentTime = target;
    } catch (err) {
      console.error(err);
      toast.error(t("record.cutFailed"));
    }
    // Always punch back in after a confirmed cut — that's the point of the gesture.
    startOrResume();
  };

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

        <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-card/50">
          {/* No padding around the video itself — every extra pixel here is a pixel of lyrics
              you can actually read. Controls sit in a slim strip along the bottom edge instead
              of floating in the middle, so they never block the words. */}
          <div
            className={`relative overflow-hidden bg-background/70 ${selectedTrack ? "aspect-video" : "h-48"}`}
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

            {recording && (
              <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-glow" />
                {mm}:{ss}
              </span>
            )}

            <button
              onClick={toggleMonitor}
              aria-pressed={monitorEnabled}
              aria-label={monitorEnabled ? t("record.monitorOff") : t("record.monitorOn")}
              title={monitorEnabled ? t("record.monitorOff") : t("record.monitorOn")}
              className={`absolute right-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold backdrop-blur-sm transition-colors ${
                monitorEnabled ? "gradient-neon text-white" : "bg-black/60 text-white/70"
              }`}
            >
              <Headphones className="h-3.5 w-3.5" />
              {monitorEnabled && t("record.monitorOn")}
            </button>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-3 pb-3 pt-8">
              <div className="pointer-events-auto flex items-center gap-3">
                {phase === "paused" ? (
                  <>
                    <ControlButton
                      onClick={startOrResume}
                      icon={<Mic className="h-5 w-5" />}
                      label={t("record.continueRecording")}
                      variant="primary"
                    />
                    <ControlButton
                      onClick={finishRecording}
                      icon={<Check className="h-5 w-5" />}
                      label={t("record.finishRecording")}
                      variant="accent"
                    />
                  </>
                ) : recording ? (
                  <>
                    <ControlButton
                      onClick={pauseRecording}
                      icon={<Pause className="h-5 w-5" />}
                      label={t("common.pause")}
                      variant="glass"
                    />
                    <ControlButton
                      onClick={finishRecording}
                      icon={<Check className="h-5 w-5" />}
                      label={t("record.finishRecording")}
                      variant="accent"
                    />
                  </>
                ) : (
                  <ControlButton
                    onClick={startOrResume}
                    icon={
                      finishMutation.isPending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Mic className="h-5 w-5" />
                      )
                    }
                    label={phase === "finished" ? t("record.reRecord") : t("common.record")}
                    variant="primary"
                    disabled={finishMutation.isPending}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="p-4">
            {selectedTrack && (
              <div className="flex items-center justify-around">
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

            {(phase === "recording" || phase === "paused") && seconds > 0 ? (
              <div className={selectedTrack ? "mt-3" : ""}>
                <ScrubBar
                  totalSeconds={seconds}
                  previewSeconds={previewSeconds}
                  onDragStart={handleScrubStart}
                  onDragMove={handleScrubMove}
                  onDragEnd={handleScrubEnd}
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{t("record.scrubHint")}</span>
                  <span className="flex items-center gap-1.5">
                    {phase === "recording" ? t("record.rec") : t("record.paused")}{" "}
                    {formatTime(previewSeconds ?? seconds)}
                  </span>
                </div>
              </div>
            ) : (
              <div
                className={`flex items-center justify-between text-[11px] text-muted-foreground ${selectedTrack ? "mt-3" : ""}`}
              >
                <span>00:00</span>
                <span className="flex items-center gap-1.5">
                  {finishMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {finishMutation.isPending ? t("record.processing") : t("record.idle")} {mm}:{ss}
                </span>
                <span>—</span>
              </div>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {t("record.opensStudioHint")}
        </p>
      </div>

      <KaraokePickerSheet
        open={karaokeOpen}
        onClose={() => setKaraokeOpen(false)}
        onSelect={(track) => {
          setSelectedTrack(track);
          setKaraokeOpen(false);
          toast.info(t("record.headphonesHint"));
        }}
      />

      <AlertDialog open={cutConfirm != null} onOpenChange={(open) => !open && cancelCut()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("record.cutConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("record.cutConfirmBody", { time: formatTime(cutConfirm ?? 0) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={cancelCut}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmCut}>
              {t("record.cutConfirmAction")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

/**
 * Horizontal timeline scrubber for rewinding into an already-recorded take. Always rendered LTR
 * regardless of the app's language direction — audio timelines read left(start)→right(now) the
 * same way voice-message scrubbers do in RTL apps, so the drag gesture stays predictable instead
 * of flipping meaning with the UI language. Dragging left of "now" previews an earlier point (the
 * region between the preview and "now" is highlighted as what would be deleted); releasing there
 * hands the target back to the caller, which decides whether that's a real rewind worth
 * confirming.
 */
function ScrubBar({
  totalSeconds,
  previewSeconds,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  totalSeconds: number;
  previewSeconds: number | null;
  onDragStart: () => void;
  onDragMove: (seconds: number) => void;
  onDragEnd: (seconds: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el || totalSeconds <= 0) return totalSeconds;
    const rect = el.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(fraction * totalSeconds);
  };

  const position = previewSeconds ?? totalSeconds;
  const fraction = totalSeconds > 0 ? position / totalSeconds : 1;
  const dragging = previewSeconds != null;

  const tickInterval = pickTickInterval(totalSeconds);
  const ticks: number[] = [];
  for (let s = 0; s <= totalSeconds; s += tickInterval) ticks.push(s);
  if (ticks[ticks.length - 1] !== totalSeconds) ticks.push(totalSeconds);

  return (
    <div dir="ltr" className="select-none">
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          if (totalSeconds < 1) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          onDragStart();
          onDragMove(seekFromClientX(e.clientX));
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          onDragMove(seekFromClientX(e.clientX));
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          onDragEnd(seekFromClientX(e.clientX));
        }}
        className="relative h-8 w-full touch-none"
      >
        {/* Floating readout above the drag point — the exact time being previewed, plus a
            scissors cue so the gesture reads as "cut here" rather than an ordinary seek. */}
        {dragging && (
          <div
            className="pointer-events-none absolute -top-8 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-md bg-destructive px-2 py-1 text-[11px] font-bold text-destructive-foreground shadow-lg"
            style={{ left: `${Math.min(92, Math.max(8, fraction * 100))}%` }}
          >
            <Scissors className="h-3 w-3" />
            {formatTime(position)}
          </div>
        )}

        {/* Fixed time markers along the take, so a drag position always reads against real
            elapsed time instead of a bare, unlabeled bar. */}
        {ticks.map((s) => (
          <div
            key={s}
            className="absolute top-0 h-1.5 w-px bg-muted-foreground/40"
            style={{ left: `${(s / totalSeconds) * 100}%` }}
          />
        ))}

        <div className="absolute inset-x-0 top-3 h-1.5 rounded-full bg-muted/50" />
        <div
          className="absolute top-3 h-1.5 rounded-full bg-primary/70"
          style={{ left: 0, width: `${fraction * 100}%` }}
        />
        {dragging && (
          <div
            className="absolute top-3 h-1.5 overflow-hidden rounded-r-full bg-destructive/25"
            style={{ left: `${fraction * 100}%`, right: 0 }}
          >
            <div
              className="h-full w-full opacity-70"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(-45deg, var(--destructive) 0 3px, transparent 3px 6px)",
              }}
            />
          </div>
        )}

        <div
          className="absolute top-3 h-4 w-4 -translate-x-1/2 -translate-y-1/4 rounded-full border-2 border-white bg-primary shadow"
          style={{ left: `${fraction * 100}%` }}
        />
      </div>

      <div className="relative h-3.5 text-[9px] text-muted-foreground">
        {ticks.map((s, i) => {
          // The first/last labels pin to the track's own edges (0% / 100% by definition) rather
          // than center-anchoring on a computed percentage, so they never clip outside the bar.
          if (i === 0)
            return (
              <span key={s} className="absolute left-0">
                {formatTime(s)}
              </span>
            );
          if (i === ticks.length - 1)
            return (
              <span key={s} className="absolute right-0">
                {formatTime(s)}
              </span>
            );
          return (
            <span
              key={s}
              className="absolute -translate-x-1/2"
              style={{ left: `${(s / totalSeconds) * 100}%` }}
            >
              {formatTime(s)}
            </span>
          );
        })}
      </div>
    </div>
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

function ControlButton({
  icon,
  label,
  onClick,
  variant = "glass",
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: "primary" | "accent" | "glass";
  disabled?: boolean;
}) {
  const variantClass =
    variant === "primary"
      ? "gradient-neon glow-pink text-white"
      : variant === "accent"
        ? "border border-accent bg-accent/20 text-accent"
        : "glass text-white";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-12 w-12 shrink-0 place-items-center rounded-full disabled:opacity-50 ${variantClass}`}
    >
      {icon}
    </button>
  );
}
