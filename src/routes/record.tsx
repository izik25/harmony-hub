import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Mic,
  Music2,
  ChevronRight,
  Search,
  X,
  Check,
  Pause,
  Loader2,
  Headphones,
  Scissors,
  ArrowLeft,
  User,
  Video,
  Sparkles,
  PartyPopper,
  Upload,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import i18n, { translateServerError } from "@/lib/i18n";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { LogoPulse } from "@/components/LogoPulse";
import { BackgroundPicker } from "@/components/BackgroundPicker";
import { FilterShop, type FilterGift } from "@/components/FilterShop";
import { FaceFilterOverlay } from "@/components/FaceFilterOverlay";
import type { FilterKind } from "@/lib/face-filters";
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
import { listGiftCatalog, buyFilterForSelf } from "@/functions/wallet";
import { listKaraokeArtists, listKaraokeTracks } from "@/functions/karaoke";
import { processRecording } from "@/lib/mix-recording";
import { commitCheckpoint, trimCheckpoint } from "@/lib/audio-splice";
import * as videoSplice from "@/lib/video-splice";
import { openSelfieCamera, buildCombinedRecorder } from "@/lib/camera-capture";
import {
  startVirtualBackground,
  type BackgroundId,
  type VirtualBackgroundComposer,
} from "@/lib/virtual-background";
import {
  routeToHeadphonesIfAvailable,
  routeAudioContextToHeadphonesIfAvailable,
} from "@/lib/audio-output";

export const Route = createFileRoute("/record")({
  component: RecordPage,
});

type KaraokeTrack = Awaited<ReturnType<typeof listKaraokeTracks>>[number];
type KaraokeArtist = Awaited<ReturnType<typeof listKaraokeArtists>>[number];

const BAR_COUNT = 48;
// Starting balance for the initial auto-mix — matches the Mix Balance defaults in studio.tsx, a
// touch under the vocal / a touch over the backing track so the take doesn't drown out the
// instrumental out of the gate. The user re-balances (and hears the result) from Studio, which
// now owns this entirely; record.tsx's only job is to get a take onto the Studio screen fast.
const DEFAULT_VOCAL_GAIN = 1.25;
const DEFAULT_BACKING_GAIN = 0.85;
// Studio-style cue: how loud the mic is fed back into the monitor tap, relative to the raw
// signal. Kept under unity so a live "hear yourself" mix doesn't come in hotter than the
// backing track and isn't right at the edge of feedback if headphones seal imperfectly.
const MONITOR_GAIN = 0.8;

// Legacy Chromium-only constraint names ("goog*") aren't in the standard MediaTrackConstraints
// type, but are still honored today and are the only way to reach past the conservative default
// NS tuning the plain boolean flags below ask for — a second-stage noise suppressor and a
// capture-side highpass to cut room rumble before it ever hits the gate in mix-recording.ts.
type ChromeAudioConstraints = MediaTrackConstraints & {
  googEchoCancellation?: boolean;
  googEchoCancellation2?: boolean;
  googAutoGainControl?: boolean;
  googAutoGainControl2?: boolean;
  googNoiseSuppression?: boolean;
  googNoiseSuppression2?: boolean;
  googHighpassFilter?: boolean;
  googTypingNoiseDetection?: boolean;
};

// echoCancellation is deliberately off (it was on before). On Android, requesting it makes
// Chromium open the mic on the platform's VOICE_COMMUNICATION audio source instead of a plain
// MIC source — that's the only way to get the phone's own hardware AEC, but that audio source
// forces Android into a "call" audio session, and that session is what silently routes playback
// through the phone's built-in earpiece/speaker instead of a connected Bluetooth headset, even
// though the headset stays genuinely connected. noiseSuppression/autoGainControl don't need that
// special audio source and can stay on safely. What we lose by dropping AEC is its help with
// backing-track bleed into the mic — already covered by ducking the karaoke video to 35% volume
// during recording (below) and by the noise gate in mix-recording.ts, so this isn't relying on
// AEC as the only line of defense against that.
const MIC_CONSTRAINTS: ChromeAudioConstraints = {
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: { ideal: 48000 },
  channelCount: { ideal: 1 },
  googEchoCancellation: false,
  googEchoCancellation2: false,
  googAutoGainControl: true,
  googAutoGainControl2: true,
  googNoiseSuppression: true,
  googNoiseSuppression2: true,
  googHighpassFilter: true,
  googTypingNoiseDetection: true,
};

// The monitor's own capture deliberately skips everything MIC_CONSTRAINTS turns on. AEC/NS/AGC
// are real-time DSP chains with their own lookahead/processing buffers — exactly what shows up
// as "hearing myself a beat late" — and none of it needs to be clean, since this stream is never
// recorded, only listened to live. `latency: 0` additionally asks the capture layer itself for
// the shortest buffering it can manage instead of its default (smoothness-favoring) buffer size.
const MONITOR_CONSTRAINTS: MediaTrackConstraints & { latency?: ConstrainDouble } = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: { ideal: 48000 },
  channelCount: { ideal: 1 },
  latency: { ideal: 0 },
};

function useMicLevels(active: boolean, monitor: boolean) {
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(6));
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  // The stream MediaRecorder actually records from — nothing else ever touches this track.
  useEffect(() => {
    if (!active) return;
    let ctx: AudioContext | undefined;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ audio: MIC_CONSTRAINTS })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        ctx = new AudioContext();
        ctx.resume().catch(() => {});
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

  // Live monitor ("Hear Yourself") gets its own, fully independent mic capture — a second
  // getUserMedia() call, its own MediaStreamTrack, opened only while monitoring is actually on.
  // It is never the same track object MediaRecorder above is recording. Two earlier attempts
  // shared the recording track itself (first straight into ctx.destination, then through a
  // second <audio> element) — attaching a second live consumer to a track that already has
  // echoCancellation running on it changes what the browser's echo canceller treats as its own
  // reference signal, which can corrupt the actual recorded audio (duplicated/phased-sounding
  // takes) independently of whether the monitor was even audible. A second, unrelated capture
  // can't do that — whatever happens to it has no path back into the track being recorded.
  //
  // The monitor is rendered through a raw Web Audio graph (source -> gain -> ctx.destination)
  // rather than an <audio> element. HTMLMediaElement playback runs through a separate, much more
  // heavily buffered rendering pipeline (built for smooth *network* playback), which is where most
  // of "hearing myself a beat late" was actually coming from — MONITOR_CONSTRAINTS' `latency: 0`
  // only shortens the *capture* side. `latencyHint: "interactive"` asks the output side for the
  // shortest buffer it can manage too, so both ends of the loop are tuned for immediacy.
  useEffect(() => {
    if (!active || !monitor) return;
    let cancelled = false;
    let monitorStream: MediaStream | undefined;
    let ctx: AudioContext | undefined;

    navigator.mediaDevices
      .getUserMedia({ audio: MONITOR_CONSTRAINTS })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        monitorStream = stream;
        ctx = new AudioContext({ latencyHint: "interactive" });
        ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        // Plain BiquadFilterNodes, not a compressor or anything with lookahead — these are
        // single-sample IIR filters with no internal buffering, so unlike NS/AEC (skipped above
        // for exactly this reason) they add no perceptible latency to the monitor loop. Without
        // them the monitor is the completely raw, unshaped capsule signal (MONITOR_CONSTRAINTS
        // turns off NS/AGC too), which is what was reading as thin/harsh once latency itself
        // stopped being the complaint (wired headphones). Mirrors the same warmth/presence/rumble
        // shaping mix-recording.ts applies to the actual recording, just lighter — this is only
        // ever heard live, never baked into anything.
        const rumble = ctx.createBiquadFilter();
        rumble.type = "highpass";
        rumble.frequency.value = 90;
        const warmth = ctx.createBiquadFilter();
        warmth.type = "lowshelf";
        warmth.frequency.value = 200;
        warmth.gain.value = 1.5;
        const presence = ctx.createBiquadFilter();
        presence.type = "peaking";
        presence.frequency.value = 3000;
        presence.Q.value = 1;
        presence.gain.value = 3;
        const gain = ctx.createGain();
        gain.gain.value = MONITOR_GAIN;
        source
          .connect(rumble)
          .connect(warmth)
          .connect(presence)
          .connect(gain)
          .connect(ctx.destination);
        // The mic getUserMedia() above (MIC_CONSTRAINTS) just granted permission, which is what
        // makes real device labels available — safe to attempt the headphone-routing fix now.
        routeAudioContextToHeadphonesIfAvailable(ctx).then((routed) => {
          if (routed?.isBluetooth) toast.info(i18n.t("record.monitorBluetoothLatency"));
        });
      })
      .catch(() => {}); // monitor is optional — a failure here shouldn't interrupt recording

    return () => {
      cancelled = true;
      ctx?.close();
      monitorStream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, monitor]);

  return { levels, stream: streamRef };
}

// Opens the raw selfie camera and, whenever a virtual background is chosen, layers a live
// segment→composite loop (virtual-background.ts) on top of it — the returned stream is always
// what should actually be shown/recorded, whether that's the plain camera feed ("none") or the
// background-replaced one. Keeping preview and recording on the exact same stream means what you
// see while framing the shot is exactly what ends up in the take.
function useSelfieCameraStream(enabled: boolean, backgroundId: BackgroundId, onDenied: () => void) {
  const [rawStream, setRawStream] = useState<MediaStream | null>(null);
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);
  const composerRef = useRef<VirtualBackgroundComposer | null>(null);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRawStream(null);
      return;
    }
    let cancelled = false;
    openSelfieCamera()
      .then((camStream) => {
        if (cancelled) {
          camStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setRawStream(camStream);
      })
      .catch(() => onDenied());
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // A hidden <video> (never attached to the DOM, same technique video-splice.ts uses for its own
  // offscreen decoding) plays the raw stream purely as a frame source for the segmenter — the
  // visible preview is driven by `outputStream` instead, so it can be swapped to the composited
  // canvas stream without the raw feed itself ever needing to change.
  useEffect(() => {
    if (!rawStream) {
      sourceVideoRef.current = null;
      return;
    }
    const source = document.createElement("video");
    source.muted = true;
    source.playsInline = true;
    source.srcObject = rawStream;
    source.play().catch(() => {});
    sourceVideoRef.current = source;
    return () => {
      rawStream.getTracks().forEach((t) => t.stop());
      source.pause();
      source.srcObject = null;
      if (sourceVideoRef.current === source) sourceVideoRef.current = null;
    };
  }, [rawStream]);

  // Tears down whatever composer belongs to this camera session the moment that session ends
  // (a new rawStream, camera turned off, or unmount) — kept separate from the retarget effect
  // below so switching between backgrounds mid-session doesn't trip this cleanup.
  useEffect(() => {
    return () => {
      composerRef.current?.stop();
      composerRef.current = null;
    };
  }, [rawStream]);

  useEffect(() => {
    if (!rawStream) {
      setOutputStream(null);
      return;
    }
    if (backgroundId === "none") {
      composerRef.current?.stop();
      composerRef.current = null;
      setOutputStream(rawStream);
      return;
    }
    // Already running for this session — just retarget it at the newly picked background instead
    // of tearing down and reloading the segmentation model again.
    if (composerRef.current) {
      composerRef.current.setBackground(backgroundId);
      return;
    }
    let cancelled = false;
    const source = sourceVideoRef.current;
    if (!source) return;
    const begin = () => {
      startVirtualBackground(source, backgroundId)
        .then((composer) => {
          if (cancelled) {
            composer.stop();
            return;
          }
          composerRef.current = composer;
          setOutputStream(composer.stream);
        })
        .catch((err) => {
          console.error(err);
          setOutputStream(rawStream); // fall back to the plain feed rather than a stuck preview
        });
    };
    if (source.readyState >= 2) begin();
    else source.addEventListener("loadeddata", begin, { once: true });
    return () => {
      cancelled = true;
      source.removeEventListener("loadeddata", begin);
    };
  }, [rawStream, backgroundId]);

  return outputStream;
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

// Flat brand colors rotated across same-purpose elements (avatar rings, icon badges, level-meter
// bars) so a grid, list, or equalizer reads as lively rather than monotonous, without ever
// blending two into a gradient on a single element.
const BRAND_COLOR_ROTATION = [
  "bg-brand-coral",
  "bg-brand-indigo",
  "bg-brand-gold",
  "bg-brand-teal",
];
const DECOR_COLOR_ROTATION = [
  "text-brand-coral",
  "text-brand-indigo",
  "text-brand-gold",
  "text-brand-teal",
];

// Purely decorative: a handful of tiny note/mic glyphs drifting upward behind the page content at
// low opacity, never intercepting taps. Same idea as the landing page's AmbientNotes, scaled down
// to fit inside a single mobile-width screen instead of a full marketing page.
function FloatingDecor({ count = 6 }: { count?: number }) {
  const items = Array.from({ length: count }).map((_, i) => ({
    Icon: i % 2 === 0 ? Music2 : Mic,
    color: DECOR_COLOR_ROTATION[i % DECOR_COLOR_ROTATION.length],
    left: `${6 + ((i * 71) % 88)}%`,
    size: 13 + (i % 3) * 5,
    duration: 8 + (i % 4) * 2,
    delay: i * 0.7,
  }));
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {items.map((it, i) => (
        <motion.span
          key={i}
          className={`absolute bottom-0 ${it.color}`}
          style={{ left: it.left }}
          animate={{ y: ["6%", "-580%"], opacity: [0, 0.16, 0], rotate: [0, 14, -10, 0] }}
          transition={{
            duration: it.duration,
            repeat: Infinity,
            ease: "easeInOut",
            delay: it.delay,
          }}
        >
          <it.Icon style={{ width: it.size, height: it.size }} />
        </motion.span>
      ))}
    </div>
  );
}

function RecordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  // True the instant Finish is tapped, well before finishMutation.isPending flips (which only
  // happens once its .mutate() call actually fires) — see finishRecording below. For a camera
  // take, stopping the recorder can itself trigger a slow real-time video-splice re-encode
  // (commitCheckpoint, when there's a prior pause/rewind checkpoint to fold in) before the
  // mutation ever starts, and that gap used to show nothing but the frozen/still-live camera
  // preview with no indication anything had happened. This flag drives the processing overlay for
  // that entire window instead, so it appears with zero perceived delay.
  const [finishing, setFinishing] = useState(false);
  const [karaokeOpen, setKaraokeOpen] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<KaraokeTrack | null>(null);
  // Defaults to on — hearing yourself as you sing is the point, so it should just work the
  // moment you start recording rather than requiring a tap to discover. localStorage still lets
  // an explicit "no" from a previous session stick.
  const [monitorEnabled, setMonitorEnabled] = useState(true);
  // Rewind-and-punch-in: previewSeconds tracks the live drag position while the user is
  // scrubbing the timeline backward; cutConfirm holds the target once they release, gating the
  // "delete back to here and re-record?" dialog.
  const [previewSeconds, setPreviewSeconds] = useState<number | null>(null);
  const [cutConfirm, setCutConfirm] = useState<number | null>(null);
  // Records the user's own camera alongside the mic, composited as a small self-preview over the
  // karaoke video, so the resulting take is an actual performance video (see finishMutation)
  // instead of audio-only. Pause/rewind-fix work exactly like the audio-only flow (same
  // baseBlobRef/checkpoint architecture below) — the only difference is which splice
  // implementation the checkpoint/cut call sites use: audio-splice.ts (instant, in-memory buffer
  // slicing) when !cameraEnabled, video-splice.ts (plays segments through a canvas + MediaRecorder
  // re-encode — see that file) when cameraEnabled.
  const [cameraEnabled, setCameraEnabled] = useState(false);
  // Which virtual background (if any) replaces whatever's actually behind the singer — "none"
  // keeps the real camera feed exactly as before. Persisted the same way monitorEnabled is, so a
  // returning user's last pick sticks instead of resetting to "none" every session.
  const [backgroundId, setBackgroundId] = useState<BackgroundId>("none");
  // A face-filter gift (party hat, sunglasses, ...) currently playing over the camera preview —
  // see FaceFilterOverlay.tsx. Unlike backgroundId this is transient: it's cleared automatically
  // a few seconds after being set, by the overlay's own onDone callback, not by the user.
  const [activeFilter, setActiveFilter] = useState<FilterKind | null>(null);
  // Which floating tray (if any) is open over the immersive full-screen stage below — the
  // TikTok-style icon rail opens one of these instead of the settings-card rows the idle/no-track
  // page still uses.
  const [openPanel, setOpenPanel] = useState<"background" | "filters" | null>(null);
  // The icon rail's small text labels (see the immersive stage below) are only there so a
  // first-time visitor can tell what each icon does — once you've actually used one, you know,
  // so all of them fade away together rather than permanently crowding the video.
  const [railHintsSeen, setRailHintsSeen] = useState(false);
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  // The stream actually shown in camVideoRef and fed to the recorder — the plain camera feed, or
  // the live background-replaced one from useSelfieCameraStream once a background is picked. Kept
  // in a ref (in addition to the hook's own state) so the recording-start effect below, which
  // polls on an interval rather than re-running per render, always reads the latest value.
  const effectiveCamStreamRef = useRef<MediaStream | null>(null);

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
  // Which splice implementation baseBlobRef's contents actually need (audio-splice.ts vs
  // video-splice.ts) — set alongside baseBlobRef every time a recorder is (re)created, and read
  // by confirmCut, which runs outside that effect.
  const spliceRef = useRef<{
    commitCheckpoint: typeof commitCheckpoint;
    trimCheckpoint: typeof trimCheckpoint;
  }>({ commitCheckpoint, trimCheckpoint });
  // Resolves once a live recorder's audio has been folded into baseBlobRef; awaited before
  // anything (finish, a new scrub) reads baseBlobRef so it never races an in-flight checkpoint.
  const checkpointPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const checkpointResolveRef = useRef<(() => void) | null>(null);
  const stopModeRef = useRef<"checkpoint" | "finish">("checkpoint");
  // Whether recording was actively running when a scrub gesture began, so releasing without a
  // real rewind (or answering "no" to the cut prompt) knows whether to resume or stay paused.
  const wasRecordingRef = useRef(false);
  const recording = phase === "recording";
  const { stream } = useMicLevels(phase === "recording" || phase === "paused", monitorEnabled);

  // Remember the monitor preference across visits, same as any other studio setting — but only
  // once someone's actually made a choice. No stored value yet means "first time here," which
  // keeps the on-by-default above rather than snapping it back off.
  useEffect(() => {
    const stored = localStorage.getItem("hh:monitorEnabled");
    if (stored != null) setMonitorEnabled(stored === "1");
    else toast.info(t("record.monitorFeedbackWarning"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMonitor = () => {
    setMonitorEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("hh:monitorEnabled", next ? "1" : "0");
      if (next) toast.info(t("record.monitorFeedbackWarning"));
      return next;
    });
  };

  // Opens (or tears down) the camera as soon as the toggle changes — independent of `phase` —
  // so the self-preview is already framed and ready before the user taps record, the same way
  // the mic-level meter is already live before recording starts. Background replacement (if any)
  // is layered on top by the hook itself; the effect below just mirrors whichever stream comes
  // back into the preview element and the ref the recorder reads from.
  const selfieStream = useSelfieCameraStream(cameraEnabled, backgroundId, () => {
    toast.error(t("record.cameraDenied"));
    setCameraEnabled(false);
  });
  useEffect(() => {
    effectiveCamStreamRef.current = selfieStream;
    if (camVideoRef.current) camVideoRef.current.srcObject = selfieStream;
  }, [selfieStream]);

  // Remembers the last background pick across visits, same pattern as monitorEnabled above.
  useEffect(() => {
    const stored = localStorage.getItem("hh:backgroundId");
    if (stored) setBackgroundId(stored as BackgroundId);
  }, []);
  const chooseBackground = (id: BackgroundId) => {
    setBackgroundId(id);
    localStorage.setItem("hh:backgroundId", id);
  };

  // Same catalog the feed's "send a gift" sheet uses (GiftSheet in routes/index.tsx) — filter
  // gifts (filterKind set) show up here as things you can buy for yourself; the exact same rows
  // work as ordinary gifts to send to someone else from the feed.
  const { data: giftCatalog } = useQuery({
    queryKey: ["giftCatalog"],
    queryFn: () => listGiftCatalog(),
    enabled: cameraEnabled,
  });
  const filterGifts: FilterGift[] = (giftCatalog ?? []).filter((g) => g.filterKind);
  const filterMutation = useMutation({
    mutationFn: (giftId: string) => buyFilterForSelf({ data: { giftId } }),
    onSuccess: (res) => {
      setActiveFilter(res.filterKind as FilterKind);
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

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
      // A camera take's rawBlob is a video file, but AudioContext.decodeAudioData transparently
      // extracts just its audio track (verified against a real recorded take) — so
      // processRecording (audio-only in, audio-only out) needs zero changes to run on it, and a
      // camera take gets a completely normal audioUrl/rawVocalUrl for free, same as any other
      // take. rawBlob is uploaded once either way, and camera mode just also points videoUrl at
      // that same upload — no separate "clean audio" extraction/upload needed.
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
      // rawBlob is WAV whenever an audio-only take went through a rewind/cut checkpoint (see
      // audio-splice.ts), a video file for a camera take, and plain WebM otherwise — name it to
      // match what it actually is.
      const rawExt = rawBlob.type.includes("wav")
        ? "wav"
        : rawBlob.type.includes("mp4")
          ? "mp4"
          : "webm";
      const [mixed, raw] = await Promise.all([
        smartUploadMedia(mixedBlob, `recording-${Date.now()}.${ext}`),
        smartUploadMedia(rawBlob, `recording-raw-${Date.now()}.${rawExt}`),
      ]);
      return createDraft({
        data: {
          audioUrl: mixed.url,
          rawVocalUrl: raw.url,
          videoUrl: cameraEnabled ? raw.url : undefined,
          backingTrackUrl: selectedTrack?.videoUrl,
          title: selectedTrack
            ? [selectedTrack.artist, selectedTrack.title].filter(Boolean).join(" — ")
            : undefined,
        },
      });
    },
    onSuccess: (draft) => navigate({ to: "/studio", search: { draftId: draft.id } }),
    onError: (e: Error) => {
      toast.error(translateServerError(e.message));
      // Lets the processing overlay clear so a failed take can be retried (re-record) instead of
      // staying stuck behind it.
      setFinishing(false);
    },
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
          // The mic stream just became ready, meaning getUserMedia (with echoCancellation) just
          // granted permission — Android may have switched to voice-call routing as a result, so
          // (re-)pin playback to a connected headset if one's available.
          routeToHeadphonesIfAvailable(videoRef.current);
        }
        // Explicit bitrate — MediaRecorder's default Opus encoding is conservative enough that
        // the raw capture itself can come out sounding thin/"voice memo"-like before any
        // cleanup even runs. 128kbps is comfortably high quality for a mono voice track.
        const usingCamera = cameraEnabled && !!effectiveCamStreamRef.current;
        const recorder = usingCamera
          ? buildCombinedRecorder(stream.current, effectiveCamStreamRef.current!).recorder
          : new MediaRecorder(stream.current, { audioBitsPerSecond: 128_000 });
        // Which splice implementation folds/cuts this take's checkpoints — audio-splice.ts's
        // in-memory buffer slicing for a normal take, video-splice.ts's canvas re-encode for a
        // camera one (see that file). Captured once per recorder since cameraEnabled can't
        // change mid-take (the toggle is disabled once recording starts).
        const splice = usingCamera ? videoSplice : { commitCheckpoint, trimCheckpoint };
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          const newBlob = new Blob(chunksRef.current, {
            type: recorder.mimeType || (usingCamera ? "video/webm" : "audio/webm"),
          });
          chunksRef.current = [];
          const mode = stopModeRef.current;
          const resolveCheckpoint = checkpointResolveRef.current;
          checkpointResolveRef.current = null;

          if (mode === "finish") {
            if (baseBlobRef.current) {
              try {
                const { blob } = await splice.commitCheckpoint(baseBlobRef.current, newBlob);
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
              const { blob } = await splice.commitCheckpoint(baseBlobRef.current, newBlob);
              baseBlobRef.current = blob;
            } catch (err) {
              console.error(err); // keep the previous checkpoint rather than losing the take
            }
          }
          resolveCheckpoint?.();
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
        spliceRef.current = splice;
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
    setOpenPanel(null); // don't leave a background/filter tray crowding the controls mid-take
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
    setFinishing(true);
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
    if (finishing || seconds < 1) return;
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
      const { blob, seconds: exact } = await spliceRef.current.trimCheckpoint(
        baseBlobRef.current,
        target,
      );
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

  const backToTrackPicker = () => {
    setSelectedTrack(null);
    setCameraEnabled(false);
    setOpenPanel(null);
  };

  // Tapping the background/filters rail icon while the camera's still off turns it on for you
  // instead of doing nothing — one tap to "add yourself, then pick a look" instead of forcing a
  // trip to a separate camera toggle first.
  const openTray = (panel: "background" | "filters") => {
    if (!cameraEnabled) setCameraEnabled(true);
    setOpenPanel((p) => (p === panel ? null : panel));
  };

  return (
    <AppShell hideNav={!!selectedTrack || karaokeOpen}>
      {!selectedTrack && <TopBar />}
      {selectedTrack ? (
        // Full-screen, TikTok-style capture stage: the karaoke video (lyrics baked in) fills the
        // entire viewport, and every control is a small floating icon over it rather than a
        // scrolling settings page — chosen once here (backgroundId/monitorEnabled/etc. all still
        // live in this component's own state, untouched by this branch) and never blocking the
        // lyrics, which always stay centered and readable.
        <div className="fixed inset-0 z-40 mx-auto flex max-w-[520px] flex-col bg-black">
          {/* These karaoke clips are 640x360 (16:9) — object-cover on a tall phone screen scales
              by height and crops nearly 75% off the sides, which was slicing most of every lyric
              line in half since the text runs almost the full width of the frame. object-contain
              fixes that (the whole clip, every word, always visible) but leaves real letterboxing
              above/below on a portrait screen; BlurredVideoBackdrop fills that space with a
              softened, scaled-up copy of the same live video (sampled from this exact element, so
              it can never drift out of sync) instead of leaving it flat black. */}
          <BlurredVideoBackdrop videoRef={videoRef} />
          <video
            ref={videoRef}
            src={selectedTrack.videoUrl}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            muted={false}
          />

          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/70 via-black/25 to-transparent px-3 pb-10 pt-4">
            <motion.button
              onClick={backToTrackPicker}
              whileTap={{ scale: 0.9 }}
              aria-label={t("record.clearTrack")}
              className="pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm"
            >
              <X className="h-4 w-4" />
            </motion.button>
            <p className="line-clamp-1 min-w-0 flex-1 text-center text-sm font-semibold text-white drop-shadow">
              {[selectedTrack.artist, selectedTrack.title].filter(Boolean).join(" — ")}
            </p>
            <div className="h-10 w-10 shrink-0" aria-hidden />
          </div>

          {/* Self-preview picture-in-picture, moved to a top corner here (rather than the bottom
              corner the compact/idle stage below still uses) since the bottom edge is now busy
              with floating record controls and the scrub bar. FaceFilterOverlay draws a bought/
              gifted filter's few-second effect on top of it — a live show effect only, never
              baked into the actual take. */}
          {cameraEnabled && (
            <div className="absolute top-20 end-3 z-20 h-32 w-24 overflow-hidden rounded-2xl border-2 border-white shadow-lg">
              <video
                ref={camVideoRef}
                muted
                autoPlay
                playsInline
                className="h-full w-full object-cover"
              />
              <FaceFilterOverlay
                videoRef={camVideoRef}
                kind={activeFilter}
                onDone={() => setActiveFilter(null)}
              />
            </div>
          )}

          {recording && (
            <span className="absolute start-3 top-20 z-20 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ring-pulse rounded-full bg-white" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              {mm}:{ss}
            </span>
          )}

          {/* The TikTok-style control column — a toggle/trigger icon per feature instead of the
              named settings-card rows the pre-selection page above still uses. Each carries a
              small caption the first time you see this screen (RailControl below); the moment you
              actually use one, all of them drop the captions and go icon-only. */}
          <div className="absolute top-1/2 end-3 z-20 flex -translate-y-1/2 flex-col items-center gap-3">
            <RailControl
              icon={<Video className="h-5 w-5" />}
              label={t("record.selfieCameraLabel")}
              showLabel={!railHintsSeen}
              onClick={() => {
                setRailHintsSeen(true);
                setCameraEnabled((v) => !v);
              }}
              disabled={recording || phase === "paused"}
              active={cameraEnabled}
            />
            <RailControl
              icon={<Sparkles className="h-5 w-5" />}
              label={t("record.backgroundLabel")}
              showLabel={!railHintsSeen}
              onClick={() => {
                setRailHintsSeen(true);
                openTray("background");
              }}
              disabled={recording || phase === "paused"}
              active={openPanel === "background" || backgroundId !== "none"}
            />
            {filterGifts.length > 0 && (
              <RailControl
                icon={<PartyPopper className="h-5 w-5" />}
                label={t("record.filterShopLabel")}
                showLabel={!railHintsSeen}
                onClick={() => {
                  setRailHintsSeen(true);
                  openTray("filters");
                }}
                disabled={recording || phase === "paused"}
                active={openPanel === "filters"}
              />
            )}
            <RailControl
              icon={<Headphones className="h-5 w-5" />}
              label={t("record.monitorOn")}
              showLabel={!railHintsSeen}
              onClick={() => {
                setRailHintsSeen(true);
                toggleMonitor();
              }}
              active={monitorEnabled}
            />
          </div>

          {/* Slide-up tray for whichever rail icon above was tapped — floats just above the
              record controls so it never covers the lyrics sitting in the middle of the frame. */}
          <AnimatePresence>
            {openPanel && (
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 24, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="pointer-events-auto absolute inset-x-3 bottom-32 z-20 rounded-2xl bg-black/70 p-3 backdrop-blur-md"
              >
                {openPanel === "background" ? (
                  <BackgroundPicker
                    value={backgroundId}
                    onChange={(id) => {
                      chooseBackground(id);
                      setOpenPanel(null);
                    }}
                    disabled={recording || phase === "paused"}
                  />
                ) : (
                  <FilterShop
                    items={filterGifts}
                    pendingId={filterMutation.isPending ? (filterMutation.variables ?? null) : null}
                    playingKind={activeFilter}
                    onBuy={(item) => {
                      filterMutation.mutate(item.id);
                      setOpenPanel(null);
                    }}
                    disabled={recording || phase === "paused"}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {finishing && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 backdrop-blur-sm">
              <LogoPulse label={t("record.processingOverlay")} labelClassName="text-white" />
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 pb-6 pt-10">
            {(phase === "recording" || phase === "paused") && seconds > 0 && (
              <div className="pointer-events-auto mb-3">
                <ScrubBar
                  totalSeconds={seconds}
                  previewSeconds={previewSeconds}
                  onDragStart={handleScrubStart}
                  onDragMove={handleScrubMove}
                  onDragEnd={handleScrubEnd}
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-white/80">
                  <span>{t("record.scrubHint")}</span>
                  <span className="flex items-center gap-1.5">
                    {phase === "recording" ? t("record.rec") : t("record.paused")}{" "}
                    {formatTime(previewSeconds ?? seconds)}
                  </span>
                </div>
              </div>
            )}
            <div className="pointer-events-auto flex items-center justify-center gap-3">
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
                <div className="relative">
                  {!finishing && (
                    <>
                      <motion.span
                        aria-hidden
                        className="absolute inset-0 -z-10 rounded-full bg-brand-coral"
                        animate={{ scale: [1, 1.9], opacity: [0.4, 0] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                      />
                      <motion.span
                        aria-hidden
                        className="absolute inset-0 -z-10 rounded-full bg-brand-coral"
                        animate={{ scale: [1, 1.9], opacity: [0.4, 0] }}
                        transition={{
                          duration: 1.8,
                          repeat: Infinity,
                          ease: "easeOut",
                          delay: 0.9,
                        }}
                      />
                    </>
                  )}
                  <ControlButton
                    onClick={startOrResume}
                    icon={
                      finishing ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Mic className="h-5 w-5" />
                      )
                    }
                    label={phase === "finished" ? t("record.reRecord") : t("common.record")}
                    variant="primary"
                    disabled={finishing}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        // A plain two-way chooser — nothing to configure here, nothing recording yet. The old
        // freestyle "just record over a mic, no song" stage used to live on this screen too, but
        // it had nothing to do with either path below, so it's gone: every take now starts from
        // one of these two doors, straight into the full-screen stage or into /upload.
        <div className="relative flex min-h-[calc(100vh-4rem)] flex-col justify-center px-4 pb-6">
          <FloatingDecor />
          <div className="relative text-center animate-fade-up">
            <h1 className="font-display text-2xl font-bold">{t("record.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("record.chooserSubtitle")}</p>
          </div>

          <div className="relative mt-8 flex flex-col gap-3">
            <motion.button
              onClick={() => setKaraokeOpen(true)}
              whileTap={{ scale: 0.97 }}
              className="hover-lift relative flex items-center gap-4 overflow-hidden rounded-3xl border border-border bg-card p-4 text-start shadow-pop animate-fade-up stagger-1"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-brand-indigo opacity-[0.12] blur-2xl"
              />
              <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand-indigo shadow-pop">
                <Music2 className="h-7 w-7 text-white" />
              </div>
              <div className="relative flex-1 overflow-hidden">
                <p className="line-clamp-1 text-base font-bold">{t("record.karaoke")}</p>
                <p className="line-clamp-1 mt-0.5 text-xs text-muted-foreground">
                  {t("record.karaokeDesc")}
                </p>
              </div>
              <ChevronRight className="relative h-5 w-5 shrink-0 text-muted-foreground" />
            </motion.button>

            <Link
              to="/upload"
              search={{}}
              className="hover-lift relative flex items-center gap-4 overflow-hidden rounded-3xl border border-border bg-card p-4 text-start shadow-pop animate-fade-up stagger-2"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-brand-teal opacity-[0.12] blur-2xl"
              />
              <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand-teal shadow-pop">
                <Upload className="h-7 w-7 text-white" />
              </div>
              <div className="relative flex-1 overflow-hidden">
                <p className="line-clamp-1 text-base font-bold">{t("upload.title")}</p>
                <p className="line-clamp-1 mt-0.5 text-xs text-muted-foreground">
                  {t("record.uploadDesc")}
                </p>
              </div>
              <ChevronRight className="relative h-5 w-5 shrink-0 text-muted-foreground" />
            </Link>
          </div>
        </div>
      )}

      <KaraokePickerFullScreen
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

// Entry point for "Choose Karaoke": lands on a photo grid of artists first, and only drops into
// that artist's own track list once one is tapped — browsing 2M+ tracks by scrolling a flat list
// was the thing this replaced. `artist` (not just a boolean) drives which screen is showing, so
// the track list can scope its header/query to that artist and the back arrow can return to the
// grid without closing the picker. Full-screen (not a bottom sheet) so picking a track flows
// straight into the immersive recording stage below without a jarring size change in between —
// the whole "record" experience, picker included, stays edge-to-edge from the moment it opens.
function KaraokePickerFullScreen({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (track: KaraokeTrack) => void;
}) {
  const { t } = useTranslation();
  const [artist, setArtist] = useState<KaraokeArtist | null>(null);

  // Reset back to the artist grid every time the picker is (re)opened, so closing mid-browse and
  // reopening later doesn't strand the user on a stale track list.
  useEffect(() => {
    if (open) setArtist(null);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-40 mx-auto flex max-w-[520px] flex-col bg-background"
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            {artist ? (
              <button
                onClick={() => setArtist(null)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("record.backToArtists")}
              </button>
            ) : (
              <h2 className="text-lg font-semibold">{t("record.chooseArtist")}</h2>
            )}
            <div className="flex-1" />
            <button
              onClick={onClose}
              aria-label={t("common.cancel")}
              className="rounded-full p-1.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 flex-col overflow-hidden px-4 pb-4 pt-3">
            {artist ? (
              <KaraokeTrackList artist={artist} onSelect={onSelect} />
            ) : (
              <KaraokeArtistGrid open={open} onSelect={setArtist} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function KaraokeArtistGrid({
  open,
  onSelect,
}: {
  open: boolean;
  onSelect: (artist: KaraokeArtist) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { data: artists } = useQuery({
    queryKey: ["karaokeArtists"],
    queryFn: () => listKaraokeArtists(),
    enabled: open,
  });
  const filtered = artists?.filter((a) =>
    a.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <label className="flex items-center gap-2 rounded-full bg-muted/60 px-4 py-2.5 ring-1 ring-border">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("record.karaokeSearchPlaceholder")}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div className="mt-3 flex-1 overflow-y-auto">
        {filtered?.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            <p>{t("record.noArtists")}</p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-x-3 gap-y-6">
          {filtered?.map((a, i) => (
            <button
              key={a.id}
              onClick={() => onSelect(a)}
              className="press-scale flex flex-col items-center gap-2 rounded-2xl p-1 text-center"
            >
              <div
                className={`animate-float-avatar grid aspect-square w-full place-items-center rounded-full p-[2px] shadow-pop ${
                  BRAND_COLOR_ROTATION[i % BRAND_COLOR_ROTATION.length]
                }`}
                style={{ animationDelay: `${(i % 6) * 0.35}s` }}
              >
                <div className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-card ring-2 ring-background">
                  {a.imageUrl ? (
                    <img
                      src={a.imageUrl}
                      alt={a.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <User className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
              </div>
              <p className="line-clamp-1 text-xs font-semibold">{a.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {t("record.songsCount", { count: a.trackCount })}
              </p>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function KaraokeTrackList({
  artist,
  onSelect,
}: {
  artist: KaraokeArtist;
  onSelect: (track: KaraokeTrack) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { data: tracks } = useQuery({
    queryKey: ["karaokeTracks", artist.name, query],
    queryFn: () => listKaraokeTracks({ data: { artist: artist.name, query } }),
  });

  return (
    <>
      <p className="mb-2 text-lg font-semibold">{artist.name}</p>
      <label className="flex items-center gap-2 rounded-full bg-muted/60 px-4 py-2.5 ring-1 ring-border">
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
            <p>{t("record.noTracksForArtist")}</p>
            <p className="mt-2 text-[11px]">{t("record.noKaraokeTracksHint")}</p>
          </div>
        )}
        {tracks?.map((track, i) => (
          <button
            key={track.id}
            onClick={() => onSelect(track)}
            className="press-scale flex w-full items-center gap-3 rounded-2xl border border-border bg-card/60 p-3 text-start hover:border-primary/50"
          >
            <div
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${
                i % 2 === 0 ? "bg-brand-teal" : "bg-brand-gold"
              }`}
            >
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
    </>
  );
}

// Fills the letterboxing around an object-contain karaoke video with a softened, scaled-up copy
// of the same live frame instead of leaving it flat black — samples directly from the real
// `<video>` element every tick (via drawImage), so unlike a second video element it can never
// drift out of sync with whatever the real one is currently doing (playing, paused, mid-scrub).
// Throttled well below the visible video's own frame rate since it's purely decorative.
function BlurredVideoBackdrop({
  videoRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let raf = 0;
    let lastDrawAt = 0;
    const FRAME_INTERVAL = 1000 / 12;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - lastDrawAt < FRAME_INTERVAL) return;
      lastDrawAt = now;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      ctx.filter = "blur(36px)";
      ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  return (
    <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full opacity-70" />
  );
}

// The immersive stage's icon-rail button: same circular glass icon as ControlButton, plus a small
// pill caption that's only there for a first-time visitor and fades away (see railHintsSeen in
// RecordPage) the moment any rail icon actually gets used.
function RailControl({
  icon,
  label,
  onClick,
  disabled,
  active,
  showLabel,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  showLabel: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <ControlButton
        icon={icon}
        label={label}
        onClick={onClick}
        disabled={disabled}
        active={active}
        variant="glass"
      />
      <AnimatePresence>
        {showLabel && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="whitespace-nowrap rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function ControlButton({
  icon,
  label,
  onClick,
  variant = "glass",
  disabled,
  active,
  size = "md",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: "primary" | "accent" | "glass";
  disabled?: boolean;
  // Highlights the button (a bright ring) to mark an on/open toggle state — used by the
  // immersive stage's icon rail (camera/background/filters/monitor), which are all persistent
  // toggles rather than one-off actions like the record/pause/finish buttons this was built for.
  active?: boolean;
  size?: "sm" | "md";
}) {
  const variantClass =
    variant === "primary"
      ? "bg-brand-coral text-white shadow-pop-coral"
      : variant === "accent"
        ? "border border-accent bg-accent/20 text-accent"
        : "glass text-foreground";
  const sizeClass = size === "sm" ? "h-11 w-11" : "h-12 w-12";
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      whileHover={disabled ? undefined : { scale: 1.05 }}
      transition={{ type: "spring", stiffness: 450, damping: 25 }}
      className={`grid ${sizeClass} shrink-0 place-items-center rounded-full disabled:opacity-50 ${variantClass} ${
        active ? "ring-2 ring-white" : ""
      }`}
    >
      {icon}
    </motion.button>
  );
}
