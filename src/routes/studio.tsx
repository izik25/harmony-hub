import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Sliders,
  Wand2,
  Send,
  Play,
  Pause,
  Loader2,
  Sparkles,
  Check,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  X,
  Mic,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as Tone from "tone";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { EmptyState } from "@/components/EmptyState";
import { getDraft, updateDraftAudio } from "@/functions/posts";
import { getVocalCleanupStatus, startVocalCleanup } from "@/functions/vocal-cleanup";
import { smartUploadMedia } from "@/lib/blob-upload";
import {
  prepareStems,
  analyzeSignal,
  applyNoiseGate,
  noiseGateThresholdFor,
} from "@/lib/mix-recording";
import { analyzePitch, applyPitchCorrection } from "@/lib/pitch-correct";
import { analyzeSong, measureLoudness, NOTE_NAMES } from "@/lib/song-analysis";
import {
  applyMix,
  buildChain,
  DEFAULT_MIX,
  disposeChain,
  renderMix,
  seekChain,
  startChain,
  stopChain,
  type MixSettings,
  type VocalChain,
} from "@/lib/vocal-chain";
import {
  pitchStrengthFor,
  planLevels,
  planProcessing,
  REVERB_PROBE,
  reverbSendFor,
  TARGET_LUFS,
  type ReportLine,
} from "@/lib/auto-master";
import { audioBufferToWavBlob } from "@/lib/wav-encoder";
import { translateServerError } from "@/lib/i18n";
import { FixSectionEditor, FixSectionToggle } from "@/components/FixSectionEditor";
import { CoverImagePicker } from "@/components/CoverImagePicker";

interface StudioSearch {
  draftId?: string;
}

// Flat brand colors rotated across the decorative waveform bars — same idiom as the equalizer
// bars on the landing page — so the strip reads as a lively flat-color equalizer instead of the
// old neon rainbow gradient sweep.
const BRAND_BAR_COLORS = ["bg-brand-coral", "bg-brand-indigo", "bg-brand-gold", "bg-brand-teal"];

// Sample peak, not RMS — vocal takes routinely have a 10dB+ crest factor, so loudness alone says
// nothing about how hard a gain change would hit the limiter.
function peakDbOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -100;
}

// peakDbOf for what actually reaches the limiter once the vocal and backing stems are summed at
// their current levels — the vocal's own peak alone says nothing about the headroom left after
// the backing track lands on top of it. Per channel, like the stereo export.
function peakDbOfMix(
  vocal: AudioBuffer,
  vocalLevel: number,
  backing: AudioBuffer | null,
  backingLevel: number,
): number {
  if (!backing) return peakDbOf(vocal) + 20 * Math.log10(vocalLevel || 1e-6);
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const v = vocal.getChannelData(Math.min(ch, vocal.numberOfChannels - 1));
    const b = backing.getChannelData(Math.min(ch, backing.numberOfChannels - 1));
    const n = Math.min(v.length, b.length);
    for (let i = 0; i < n; i++) {
      const abs = Math.abs(v[i] * vocalLevel + b[i] * backingLevel);
      if (abs > peak) peak = abs;
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -100;
}

function formatTime(s: number) {
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  return `${m}:${ss}`;
}

export const Route = createFileRoute("/studio")({
  validateSearch: (search: Record<string, unknown>): StudioSearch => ({
    draftId: typeof search.draftId === "string" ? search.draftId : undefined,
  }),
  component: StudioPage,
});

type DraftDTO = Awaited<ReturnType<typeof getDraft>>;

/** What the chain plays: separate vocal/backing stems when the draft has its raw take, or just the
 * already-mixed audioUrl (uploaded files, drafts from before stems existed) as the "vocal". */
type Sources = {
  vocalUrl: string;
  backingUrl: string | null;
  stems: boolean;
  /** The vocal is the Replicate-cleaned take (functions/vocal-cleanup.ts), not the raw one. */
  cleanVocal: boolean;
};

type MasterStage = "idle" | "analyzing" | "tuning" | "mastering" | "verifying" | "done";
const MASTER_STEPS = ["analyzing", "tuning", "mastering", "verifying"] as const;
const MASTER_STEP_LABELS: Record<(typeof MASTER_STEPS)[number], string> = {
  analyzing: "studio.stageAnalyze",
  tuning: "studio.stageTune",
  mastering: "studio.stageMaster",
  verifying: "studio.stageVerify",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Loudness as it's actually heard on two speakers — a mono buffer plays in both. */
function loudnessOf(buffer: AudioBuffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
    buffer.getChannelData(ch),
  );
  return measureLoudness(
    channels.length === 1 ? [channels[0], channels[0]] : channels,
    buffer.sampleRate,
  );
}

function StudioPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const draftId = search.draftId;

  // Strength (0-100) of the pitch correction baked into the loaded buffer — the real engine in
  // pitch-correct.ts (per-note correction + PSOLA resynthesis). Dragging the slider bakes it in a
  // beat after it stops moving (see runPitchCorrection) rather than live, since per-note pitch
  // tracking can't run inside a live Web Audio graph. AI mastering sets it too.
  const [autotune, setA] = useState(0);
  // Every other knob — see MixSettings in vocal-chain.ts. Live: changes apply to the chain as you
  // drag, and publish renders exactly these values.
  const [mix, setMix] = useState<MixSettings>(DEFAULT_MIX);
  const setMixValue =
    <K extends keyof MixSettings>(key: K) =>
    (value: MixSettings[K]) =>
      setMix((m) => ({ ...m, [key]: value }));
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  // Whether AI mastering's noise gate is baked into the loaded buffer — runPitchCorrection
  // re-applies it after restoring the original, since gating changes what pitch detection sees.
  const gateAppliedRef = useRef(false);
  // The song's scale (from analyzeSong) that pitch correction aims at — undefined until AI
  // mastering has detected a confident key for this take, which means "nearest semitone".
  const pitchScaleRef = useRef<number[] | undefined>(undefined);
  // The backing track's own A4 (from analyzeSong's tuningCents) — notes are tuned to the music,
  // not to a standard the music may not be at.
  const referenceA4Ref = useRef(440);
  const [fixSectionOpen, setFixSectionOpen] = useState(false);
  // Whether the "replace video with a cover image" picker is expanded — see replaceCoverMutation.
  const [replacingCover, setReplacingCover] = useState(false);

  const chainRef = useRef<VocalChain | null>(null);
  // The camera take's own video, when present — muted, and driven entirely by the Tone chain's
  // play/pause/seek below rather than its own <audio> track, so the take reads as one finished
  // video+audio product on one shared timeline instead of two separate, unsynced players (a plain
  // video with its own controls sitting above an unrelated audio scrubber).
  const draftVideoRef = useRef<HTMLVideoElement | null>(null);
  // Playback position bookkeeping for the scrubber — Tone.Player has no native currentTime/
  // timeupdate the way <audio> does, so position is hand-tracked: positionRef is the source of
  // truth (in buffer seconds), advanced each animation frame by real elapsed time scaled by the
  // live playback rate, and written to directly on seek so dragging and playback never fight.
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  // Untouched copy of the currently-loaded take's channel data, captured once right after decode
  // (see the load effect below) — every destructive pass (runPitchCorrection, applyMaster)
  // restores from this first, so repeated adjustments always derive fresh from the same clean
  // source instead of compounding correction on top of correction.
  const originalChannelsRef = useRef<Float32Array[] | null>(null);
  // Debounce handle for committing the Autotune slider's drag into the buffer — see
  // runPitchCorrection and the comment by the autotune state above.
  const autotuneCommitTimer = useRef<number | null>(null);
  // What the chain is playing — see the stems effect below. null while stems are being prepared.
  const [sources, setSources] = useState<Sources | null>(null);
  const stems = sources?.stems ?? false;
  // Mirrors the settings without being a dependency of the chain-(re)build effect below — a Fix a
  // Section save swaps the stems and rebuilds the chain, which should keep the current settings.
  const mixRef = useRef<MixSettings>(mix);
  useEffect(() => {
    mixRef.current = mix;
  });

  // Restores the currently-loaded buffer to the untouched take before (re-)applying destructive
  // correction — see originalChannelsRef above.
  const restoreOriginalBuffer = (buffer: AudioBuffer) => {
    const original = originalChannelsRef.current;
    if (!original) return;
    for (let ch = 0; ch < buffer.numberOfChannels && ch < original.length; ch++) {
      buffer.getChannelData(ch).set(original[ch]);
    }
  };

  // The real "autotune" engine (pitch-correct.ts), shared by the manual slider and AI Mastering —
  // always restores the clean original first (see restoreOriginalBuffer) so this is idempotent
  // regardless of how many times or in what order it's called, reapplies the noise gate if one was
  // already baked in (gating changes the signal pitch-correction analyzes, so order matters), then
  // applies pitch correction at the given strength.
  const runPitchCorrection = (strength: number) => {
    const chain = chainRef.current;
    const buffer = chain?.player.buffer.get();
    if (!chain || !buffer || !originalChannelsRef.current) return;
    restoreOriginalBuffer(buffer);
    if (gateAppliedRef.current) {
      applyNoiseGate(buffer, noiseGateThresholdFor(analyzeSignal(buffer)));
    }
    const clamped = Math.min(1, Math.max(0, strength));
    if (clamped > 0) {
      applyPitchCorrection(buffer, clamped, pitchScaleRef.current, referenceA4Ref.current);
    }
  };

  // Autotune slider onChange: keeps the number responsive while dragging, but only bakes the
  // (relatively costly, and audibly disruptive mid-drag) correction pass in ~300ms after the user
  // stops moving it, not on every intermediate value.
  const handleAutotuneChange = (n: number) => {
    setA(n);
    if (autotuneCommitTimer.current != null) window.clearTimeout(autotuneCommitTimer.current);
    autotuneCommitTimer.current = window.setTimeout(() => runPitchCorrection(n / 100), 300);
  };

  const { data: draft } = useQuery({
    queryKey: ["draft", draftId],
    queryFn: () => getDraft({ data: { id: draftId! } }),
    enabled: !!draftId,
  });

  const stopTicking = () => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    lastFrameRef.current = null;
  };

  // Playing/ticking state is managed entirely from here rather than Tone.Player's `onstop`
  // callback — that callback also fires as a side effect of `.seek()` while actively playing
  // (Web Audio has no live-seek primitive, so Tone swaps the underlying source node under the
  // hood), which would otherwise be indistinguishable from a real stop and kill the tick loop
  // mid-scrub.
  const tick = (time: number) => {
    if (lastFrameRef.current == null) lastFrameRef.current = time;
    const dt = (time - lastFrameRef.current) / 1000;
    lastFrameRef.current = time;
    const rate = mixRef.current.speed / 100;
    positionRef.current = Math.min(positionRef.current + dt * rate, durationRef.current);
    setCurrentTime(positionRef.current);
    // The video plays on its own native clock once started (see togglePlay) — this only nudges
    // it back in line if it's drifted noticeably, rather than fighting it every frame.
    const video = draftVideoRef.current;
    if (video && Math.abs(video.currentTime - positionRef.current) > 0.25) {
      video.currentTime = positionRef.current;
    }
    if (positionRef.current >= durationRef.current) {
      if (chainRef.current) stopChain(chainRef.current);
      video?.pause();
      setPlaying(false);
      stopTicking();
      return;
    }
    rafIdRef.current = requestAnimationFrame(tick);
  };

  // Re-derives the vocal and backing stems from the raw take (prepareStems) instead of loading the
  // pre-mixed audioUrl, so every knob below processes the voice alone and the backing comes back
  // in clean underneath it — and drafts recorded before the bleed-delay alignment existed get it
  // retroactively, since it's measured fresh from the raw take every time. The vocal stem is
  // rendered at unity gain; the Mix Balance sliders apply the actual levels live. Drafts with no
  // raw take (uploads) — or a raw take that fails to process — fall back to the mixed file.
  //
  // AI Vocal Cleanup (functions/vocal-cleanup.ts) swaps in the model-cleaned take as the vocal
  // source once it exists — on by default, with the toggle there for an honest before/after.
  const cleanupStatus = useQuery({
    queryKey: ["vocalCleanup", draftId],
    queryFn: () => getVocalCleanupStatus({ data: { draftId: draftId! } }),
    enabled: !!draftId && !!draft?.rawVocalUrl,
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 4000 : false),
  });
  // "AI Cleanup & Mastering" is one action: the take goes to Replicate first, and once the cleaned
  // vocal is loaded into the chain applyMaster runs on it automatically (see the load effect
  // below). This flag is what tells that load "the user just asked for this — announce it", and
  // is mirrored into a ref because the load effect's promise outlives the render that started it.
  const [awaitingMaster, setAwaitingMasterState] = useState(false);
  // Where the mastering half is — shown step by step, with the analysis's real progress.
  const [masterStage, setMasterStage] = useState<MasterStage>("idle");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  // What the analysis found and what was changed because of it, one line each.
  const [masterReport, setMasterReport] = useState<string[]>([]);
  // Bumped per mastering run and per take load, so a run that's still analyzing when the take
  // changes (or a newer run starts) drops its result instead of applying it to the wrong buffer.
  const masterRunRef = useRef(0);
  const awaitingMasterRef = useRef(false);
  const setAwaitingMaster = (v: boolean) => {
    awaitingMasterRef.current = v;
    setAwaitingMasterState(v);
  };
  // Why the cleanup couldn't start (not configured, out of credits…), kept on screen. There's
  // deliberately no silent fallback to mastering the raw take: that made a cleanup that never
  // reached Replicate look exactly like one that had.
  const [cleanupError, setCleanupError] = useState("");
  // Wall-clock time since the cleanup was sent, ticking while it's in flight.
  const [cleanupStartedAt, setCleanupStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cleanupMutation = useMutation({
    mutationFn: () => startVocalCleanup({ data: { draftId: draftId! } }),
    onMutate: () => {
      setCleanupError("");
      setCleanupStartedAt(Date.now());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vocalCleanup", draftId] }),
    onError: (e: Error) => {
      setAwaitingMaster(false);
      setCleanupError(translateServerError(e.message));
    },
  });
  const cleanupState = cleanupStatus.data?.status;
  useEffect(() => {
    if (cleanupState === "failed") setAwaitingMaster(false);
  }, [cleanupState]);
  useEffect(() => {
    if (cleanupState !== "processing" && !cleanupMutation.isPending) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [cleanupState, cleanupMutation.isPending]);
  // Evidence the take really went through Replicate: the job id and the GPU time Replicate
  // reported, from the poll that collected the result.
  const replicateProof =
    cleanupStatus.data?.status === "succeeded" && "predictionId" in cleanupStatus.data
      ? cleanupStatus.data
      : null;
  const cleanVocalUrl =
    cleanupStatus.data?.status === "succeeded"
      ? cleanupStatus.data.cleanVocalUrl
      : (draft?.cleanVocalUrl ?? "");
  const [useCleanVocal, setUseCleanVocal] = useState(true);
  const activeCleanVocalUrl = useCleanVocal ? cleanVocalUrl : "";
  const stemSourceKey = draft
    ? draft.rawVocalUrl
      ? `stems|${draft.rawVocalUrl}|${activeCleanVocalUrl}|${draft.backingTrackUrl ?? ""}|${draft.backingStartOffsetSeconds ?? 0}`
      : `mix|${draft.audioUrl ?? ""}`
    : null;
  useEffect(() => {
    if (!draft || !stemSourceKey) return;
    let cancelled = false;
    const objectUrls: string[] = [];
    const fallback = (): Sources | null =>
      draft.audioUrl
        ? { vocalUrl: draft.audioUrl, backingUrl: null, stems: false, cleanVocal: false }
        : null;
    setSources(null);
    setReady(false);
    if (!draft.rawVocalUrl) {
      setSources(fallback());
      return;
    }
    (async () => {
      const [raw, clean] = await Promise.all([
        fetch(draft.rawVocalUrl!).then((r) => r.blob()),
        activeCleanVocalUrl ? fetch(activeCleanVocalUrl).then((r) => r.blob()) : undefined,
      ]);
      const { vocal, backing } = await prepareStems(
        raw,
        draft.backingTrackUrl || undefined,
        { backingStartOffsetSeconds: draft.backingStartOffsetSeconds, finish: false },
        clean,
      );
      const toUrl = (buffer: AudioBuffer) => {
        const url = URL.createObjectURL(audioBufferToWavBlob(buffer));
        objectUrls.push(url);
        return url;
      };
      const next = { vocalUrl: toUrl(vocal), backingUrl: backing ? toUrl(backing) : null };
      if (!cancelled) setSources({ ...next, stems: true, cleanVocal: !!clean });
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setSources(fallback());
    });
    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemSourceKey]);

  useEffect(() => {
    if (!sources) return;
    let disposed = false;
    stopTicking();
    setPlaying(false);
    positionRef.current = 0;
    setCurrentTime(0);
    if (draftVideoRef.current) {
      draftVideoRef.current.pause();
      draftVideoRef.current.currentTime = 0;
    }
    const chain = buildChain();
    chainRef.current = chain;
    gateAppliedRef.current = false;
    pitchScaleRef.current = undefined;
    referenceA4Ref.current = 440;
    masterRunRef.current++;
    setMasterStage("idle");
    setMasterReport([]);
    originalChannelsRef.current = null;
    setMix((m) => ({ ...m, gainDb: 0 }));
    mixRef.current = { ...mixRef.current, gainDb: 0 };
    setA(0);
    setReady(false);
    const loadWithRetry = async (player: Tone.Player, url: string, attempts = 4): Promise<void> => {
      for (let i = 0; i < attempts; i++) {
        try {
          await player.load(url);
          return;
        } catch (err) {
          if (i === attempts - 1) throw err;
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    };
    Promise.all([
      loadWithRetry(chain.player, sources.vocalUrl),
      sources.backingUrl ? loadWithRetry(chain.backingPlayer, sources.backingUrl) : null,
    ])
      .then(() => {
        if (disposed) return;
        const buf = chain.player.buffer.get();
        if (buf) {
          originalChannelsRef.current = Array.from({ length: buf.numberOfChannels }, (_, ch) =>
            buf.getChannelData(ch).slice(),
          );
        }
        // Gain staging: the take's loud passages to −18 dBFS before the chain (see vocal-chain.ts).
        const inputTrimDb = buf
          ? Math.round(clamp(-18 - analyzeSignal(buf).vocalLevelDb, -24, 24) * 10) / 10
          : 0;
        mixRef.current = { ...mixRef.current, inputTrimDb };
        setMix((m) => ({ ...m, inputTrimDb }));
        applyMix(chain, mixRef.current, sources.stems);
        const dur = chain.player.buffer.duration || 0;
        durationRef.current = dur;
        setDuration(dur);
        setReady(true);
        // A cleaned vocal is never handed over raw: our own analysis decides gate, EQ,
        // compression, reverb, vocal/playback balance and loudness on top of it right away, so
        // the user lands on a finished track. Manual Mastering can still override any of it.
        // Also runs when a requested cleanup couldn't load as stems and fell back to the mix —
        // the user still asked for a mastered track.
        if (sources.cleanVocal || awaitingMasterRef.current) {
          applyMasterRef.current({ announce: awaitingMasterRef.current });
          setAwaitingMaster(false);
        }
      })
      .catch((err) => {
        if (!disposed) toast.error(t("studio.couldNotLoad"));
        setAwaitingMaster(false);
        console.error(err);
      });
    return () => {
      disposed = true;
      stopTicking();
      if (autotuneCommitTimer.current != null) {
        window.clearTimeout(autotuneCommitTimer.current);
        autotuneCommitTimer.current = null;
      }
      // The next chain only exists once the next stems are ready — until then, nothing (slider
      // effects, AI Mastering, play) should touch this disposed one.
      if (chainRef.current === chain) chainRef.current = null;
      disposeChain(chain);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  useEffect(() => {
    if (!chainRef.current) return;
    applyMix(chainRef.current, mix, stems);
    if (draftVideoRef.current) draftVideoRef.current.playbackRate = mix.speed / 100;
  }, [mix, stems]);

  const togglePlay = async () => {
    const chain = chainRef.current;
    if (!chain || !ready) return;
    await Tone.start();
    const video = draftVideoRef.current;
    if (playing) {
      stopChain(chain);
      video?.pause();
      setPlaying(false);
      stopTicking();
    } else {
      if (positionRef.current >= durationRef.current) {
        positionRef.current = 0;
        setCurrentTime(0);
      }
      startChain(chain, positionRef.current);
      if (video) {
        video.currentTime = positionRef.current;
        video.play().catch(() => {});
      }
      setPlaying(true);
      lastFrameRef.current = null;
      rafIdRef.current = requestAnimationFrame(tick);
    }
  };

  // Lets the scrubber move playback to any point without restarting from the top — the whole
  // point being that after tweaking a slider or re-recording a section, you can jump straight
  // back to that spot instead of listening through the entire take again. Seeks the video (when
  // present) to the same point so it never falls out of sync with the audio being dragged.
  const handleSeek = (value: number) => {
    const chain = chainRef.current;
    if (!chain || !ready) return;
    const clamped = Math.min(Math.max(value, 0), durationRef.current);
    positionRef.current = clamped;
    setCurrentTime(clamped);
    lastFrameRef.current = null;
    seekChain(chain, clamped);
    if (draftVideoRef.current) draftVideoRef.current.currentTime = clamped;
  };

  // Stops the main preview before opening Fix a Section — two audio sources (this one plus its
  // own internal <audio> for the raw vocal) shouldn't ever play at once — and hands it the
  // scrubber's current position so the fix's start marker is already sitting where you were
  // listening instead of at 0.
  const openFixSection = () => {
    const chain = chainRef.current;
    if (chain && playing) {
      stopChain(chain);
      draftVideoRef.current?.pause();
      setPlaying(false);
      stopTicking();
    }
    setFixSectionOpen(true);
  };

  // Publish renders the live buffers — gated and pitch-corrected exactly as heard — through the
  // same chain settings, so what you hear in Studio is what gets uploaded.
  const renderProcessed = async (): Promise<Blob> => {
    const chain = chainRef.current;
    const vocal = chain?.player.buffer.get();
    if (!chain || !ready || !vocal) throw new Error(t("studio.loadTrackFirst"));
    const backing = chain.backingPlayer.loaded ? (chain.backingPlayer.buffer.get() ?? null) : null;
    try {
      return audioBufferToWavBlob(await renderMix(vocal, backing, mix, stems), 16);
    } catch {
      throw new Error(t("studio.exportFailed"));
    }
  };

  const publishMutation = useMutation({
    mutationFn: async (forCompetition: boolean) => {
      if (!draftId) throw new Error(t("studio.nothingToPublish"));
      const blob = await renderProcessed();
      const { url } = await smartUploadMedia(blob, `studio-${Date.now()}.wav`);
      await updateDraftAudio({ data: { id: draftId, audioUrl: url } });
      return { id: draftId, forCompetition };
    },
    onSuccess: ({ id, forCompetition }) =>
      navigate({
        to: "/upload",
        search: forCompetition ? { draftId: id, forCompetition: 1 } : { draftId: id },
      }),
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  // Swaps a camera take's performance video for a still cover image (AI-generated or manually
  // uploaded) — or for a different video, mirroring the publish screen's own cover picker, which
  // accepts either. Doesn't touch audioUrl/rawVocalUrl, so DSP/Mastering/Fix a Section keep
  // working on the same underlying take either way.
  const replaceCoverMutation = useMutation({
    mutationFn: async (result: { url: string; isVideo: boolean }) => {
      if (!draftId || !draft?.audioUrl) throw new Error(t("studio.nothingToPublish"));
      await updateDraftAudio({
        data: {
          id: draftId,
          audioUrl: draft.audioUrl,
          videoUrl: result.isVideo ? result.url : "",
          coverUrl: result.isVideo ? draft.coverUrl : result.url,
        },
      });
      return result;
    },
    onSuccess: (result) => {
      queryClient.setQueryData<DraftDTO>(["draft", draftId], (old) =>
        old
          ? {
              ...old,
              videoUrl: result.isVideo ? result.url : "",
              coverUrl: result.isVideo ? old.coverUrl : result.url,
            }
          : old,
      );
      setReplacingCover(false);
      toast.success(t("studio.coverReplacedToast"));
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  // AI mastering, run on the cleaned take: measure the song, retune the voice, set each stage of
  // the vocal chain from what was measured (planProcessing — standard engineering ranges, placed
  // by the analysis), then render the result and measure it: balance and loudness come from that
  // render, and a final render checks the mix actually lands on the streaming target. Every
  // decision becomes a line in masterReport.
  const applyMaster = async ({ announce }: { announce: boolean }) => {
    const chain = chainRef.current;
    const buffer = chain?.player.buffer.get();
    if (!chain || !buffer) {
      toast.error(t("studio.loadTrackFirst"));
      return;
    }
    const run = ++masterRunRef.current;
    const stale = () => run !== masterRunRef.current || chainRef.current !== chain;
    const step = async (stage: MasterStage) => {
      setMasterStage(stage);
      // Let the step list repaint before the next (synchronous, heavy) stage.
      await new Promise((r) => setTimeout(r, 0));
      return !stale();
    };
    if (autotuneCommitTimer.current != null) {
      window.clearTimeout(autotuneCommitTimer.current);
      autotuneCommitTimer.current = null;
    }
    setAnalysisProgress(0);
    setMasterReport([]);
    setMasterStage("analyzing");
    restoreOriginalBuffer(buffer);
    const isClean = !!sources?.cleanVocal;
    const lines: ReportLine[] = [];

    try {
      // The model already took the noise out of a cleaned take; a raw one gets the same gate
      // processRecording uses, unless it's already studio-quiet.
      const before = analyzeSignal(buffer);
      const gate =
        !isClean &&
        !(before.noiseFloorDb <= -42 && before.vocalLevelDb - before.noiseFloorDb >= 20);
      if (gate) {
        applyNoiseGate(buffer, noiseGateThresholdFor(before));
        lines.push({ key: "studio.reportGate" });
      }
      gateAppliedRef.current = gate;
      const noiseFloorDb = gate ? analyzeSignal(buffer).noiseFloorDb : before.noiseFloorDb;
      const backingBuffer =
        stems && chain.backingPlayer.loaded ? (chain.backingPlayer.buffer.get() ?? null) : null;

      const song = await analyzeSong(buffer, backingBuffer, (f) => {
        if (!stale()) setAnalysisProgress(f);
      });
      if (!(await step("tuning"))) return;

      const scale = song.key && song.key.confidence >= 0.6 ? song.key.scale : undefined;
      pitchScaleRef.current = scale;
      if (song.key) {
        const keyName = `${NOTE_NAMES[song.key.tonic]} ${t(song.key.mode === "major" ? "studio.modeMajor" : "studio.modeMinor")}`;
        lines.push({
          key: scale ? "studio.reportKeyScale" : "studio.reportKey",
          values: { key: keyName },
        });
      }
      // Small offsets are left at A440: under 3 cents nobody hears the difference, and it keeps a
      // marginal measurement from moving anything.
      const tuning =
        song.tuningCents != null && Math.abs(song.tuningCents) >= 3 ? song.tuningCents : 0;
      const referenceA4 = 440 * 2 ** (tuning / 1200);
      referenceA4Ref.current = referenceA4;
      if (tuning !== 0) {
        lines.push({ key: "studio.reportTuning", values: { cents: Math.round(Math.abs(tuning)) } });
      }
      const pitchBefore = analyzePitch(buffer, scale, referenceA4);
      const strength = pitchStrengthFor(pitchBefore);
      if (strength > 0) {
        applyPitchCorrection(buffer, strength, scale, referenceA4);
        const pitchAfter = analyzePitch(buffer, scale, referenceA4);
        lines.push({
          key: "studio.reportPitchFixed",
          values: {
            off: pitchBefore.offNotes,
            notes: pitchBefore.noteCount,
            before: Math.round(pitchBefore.avgAbsCents),
            after: Math.round(pitchAfter.avgAbsCents),
            pct: Math.round(strength * 100),
          },
        });
      } else if (pitchBefore.voicedRatio >= 0.15) {
        lines.push({ key: "studio.reportPitchOk" });
      }
      setA(Math.round(strength * 100));
      if (!(await step("mastering"))) return;

      const {
        settings: processed,
        report,
        reverbTargetLu,
        reverbReport,
      } = planProcessing({
        song,
        pitch: pitchBefore,
        isClean,
        noiseFloorDb,
        base: { ...mixRef.current, speed: 100, gainDb: 0 },
      });
      lines.push(...report);
      if (!(await step("verifying"))) return;

      // Measure instead of guessing: the processed voice rendered dry, then with the reverb at a
      // probe level — the difference is the reverb alone, so the send can be set to land it at its
      // target under this voice.
      const dryRender = await renderMix(
        buffer,
        null,
        { ...processed, reverb: 0, delay: 0, vocalVolume: 100 },
        false,
      );
      if (stale()) return;
      const vocalLufs = loudnessOf(dryRender).lufs;
      const probeRender = await renderMix(buffer, null, { ...processed, vocalVolume: 100 }, false);
      if (stale()) return;
      const reverbOnly = [0, 1].map((ch) => {
        const dry = dryRender.getChannelData(ch);
        return probeRender.getChannelData(ch).map((x, i) => x - (dry[i] ?? 0));
      });
      const probeLu = measureLoudness(reverbOnly, dryRender.sampleRate).lufs - vocalLufs;
      const reverb = reverbSendFor(probeLu, reverbTargetLu);
      const spaced = { ...processed, reverb };
      lines.push(reverbReport(reverb > 0 ? probeLu + 20 * Math.log10(reverb / REVERB_PROBE) : -99));
      const backingLufs = backingBuffer ? loudnessOf(backingBuffer).lufs : null;
      const density = song.backing?.density ?? 0.5;
      const { settings: leveled, gapDb } = planLevels({
        vocalLufs,
        backingLufs,
        density,
        base: spaced,
        mixPeakDbAt: (vl, bl) => peakDbOfMix(dryRender, vl, backingBuffer, bl),
      });
      if (gapDb != null) {
        lines.push({
          key: "studio.reportBalance",
          values: {
            db: gapDb.toFixed(1),
            arrangement: t(density >= 0.6 ? "studio.reportDense" : "studio.reportSparse"),
          },
        });
      }

      // Final check: the whole mix, rendered and measured. The limiter shaves a little off any
      // estimate, so one correction pass lands it — boosts capped at +2dB so the fix never comes
      // from pushing the limiter harder.
      let final = leveled;
      let measured = loudnessOf(await renderMix(buffer, backingBuffer, final, stems));
      if (stale()) return;
      const miss = TARGET_LUFS - measured.lufs;
      if (Math.abs(miss) > 0.5) {
        final = {
          ...final,
          gainDb: Math.round(clamp(final.gainDb + Math.min(miss, 2), -12, 9) * 10) / 10,
        };
        measured = loudnessOf(await renderMix(buffer, backingBuffer, final, stems));
        if (stale()) return;
      }
      lines.push({
        key: "studio.reportLoudnessFinal",
        values: { lufs: measured.lufs.toFixed(1), peak: measured.peakDb.toFixed(1) },
      });

      setMix({ ...final, speed: mixRef.current.speed });
      setMasterReport(lines.map((line) => t(line.key, line.values)));
      setMasterStage("done");
      if (announce)
        toast.success(t(isClean ? "studio.cleanupDoneToast" : "studio.masterDoneToast"));
    } catch (err) {
      console.error(err);
      if (stale()) return;
      setMasterStage("idle");
      toast.error(t("studio.masterFailed"));
    }
  };
  const applyMasterRef = useRef(applyMaster);
  applyMasterRef.current = applyMaster;

  // The one "AI Cleanup & Mastering" button. With a raw take, it goes through Replicate first and
  // the load effect masters the result once it's in; switching back from Original re-masters the
  // same way. Uploads (no raw take to clean) go straight to our own mastering pass.
  const runAiMaster = () => {
    if (draft?.rawVocalUrl && !cleanVocalUrl) {
      setAwaitingMaster(true);
      cleanupMutation.mutate();
    } else if (cleanVocalUrl && !useCleanVocal) {
      setAwaitingMaster(true);
      setUseCleanVocal(true);
    } else {
      void applyMaster({ announce: true });
    }
  };
  const cleaningNow = cleanupMutation.isPending || cleanupState === "processing";
  const aiMasterBusy =
    awaitingMaster ||
    cleaningNow ||
    MASTER_STEPS.includes(masterStage as (typeof MASTER_STEPS)[number]);
  type StepState = "pending" | "active" | "done";
  const replicateStatus =
    cleanupStatus.data?.status === "processing" && "replicateStatus" in cleanupStatus.data
      ? cleanupStatus.data.replicateStatus
      : null;
  const masterStepIndex = MASTER_STEPS.indexOf(masterStage as (typeof MASTER_STEPS)[number]);
  const steps: { label: string; state: StepState; progress?: number; detail?: string }[] = [
    ...(draft?.rawVocalUrl
      ? [
          {
            label: t("studio.stageClean"),
            state: (cleaningNow ? "active" : cleanVocalUrl ? "done" : "pending") as StepState,
            detail: cleaningNow
              ? [
                  replicateStatus === "starting"
                    ? t("studio.replicateStarting")
                    : replicateStatus
                      ? t("studio.replicateProcessing")
                      : t("studio.replicateSending"),
                  cleanupStartedAt ? formatTime(Math.max(0, (now - cleanupStartedAt) / 1000)) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined,
          },
        ]
      : []),
    ...MASTER_STEPS.map((stage, i) => ({
      label: t(MASTER_STEP_LABELS[stage]),
      state: (masterStepIndex === i
        ? "active"
        : masterStepIndex > i
          ? "done"
          : "pending") as StepState,
      progress: stage === "analyzing" && masterStepIndex === 0 ? analysisProgress : undefined,
    })),
  ];

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <div className="flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-accent" />
          <h1 className="font-display text-2xl font-bold">{t("studio.title")}</h1>
        </div>
        <p className="text-xs text-muted-foreground">{t("studio.subtitle")}</p>

        {!draftId ? (
          <EmptyState
            icon={Wand2}
            title={t("studio.noTrack")}
            className="mt-6"
            action={
              <div className="flex gap-2">
                <Link
                  to="/record"
                  className="flex items-center gap-1.5 rounded-full bg-brand-coral px-5 py-2.5 text-sm font-bold text-white shadow-pop-coral press-scale"
                >
                  <Mic className="h-4 w-4" />
                  {t("studio.record")}
                </Link>
                <Link
                  to="/upload"
                  search={{}}
                  className="flex items-center gap-1.5 rounded-full border border-border px-5 py-2.5 text-sm font-semibold press-scale"
                >
                  <Upload className="h-4 w-4" />
                  {t("studio.upload")}
                </Link>
              </div>
            }
          />
        ) : (
          <>
            {/* One shared player for the whole take: when a camera video is attached, it's the
                visual (muted — audio comes from the Tone chain below, driven by the same
                play/scrub controls), otherwise the usual bar visualizer. Either way, this is a
                single finished product on one timeline — drag to scrub, tap to play, and the
                video and the (possibly DSP-processed) audio always move together — rather than a
                video with its own controls sitting above an unrelated, separately-scrubbed audio
                player. The underlying take still carries a normal audioUrl/rawVocalUrl (see
                finishMutation in record.tsx and the video-aware Fix a Section save below), so the
                full DSP/Mastering/Fix-a-Section UI further down applies to it exactly like any
                audio-only draft. */}
            <div className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-pop">
              <div
                className={`relative overflow-hidden rounded-xl bg-muted ${draft?.videoUrl ? "aspect-[9/16]" : "h-24"}`}
              >
                {draft?.videoUrl ? (
                  <video
                    ref={draftVideoRef}
                    src={draft.videoUrl}
                    muted
                    playsInline
                    className="h-full w-full bg-black object-contain"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-around px-2">
                    {Array.from({ length: 60 }).map((_, i) => (
                      <span
                        key={i}
                        className={`w-0.5 rounded-full ${BRAND_BAR_COLORS[i % BRAND_BAR_COLORS.length]}`}
                        style={{ height: `${12 + Math.abs(Math.sin(i / 3)) * 60}%` }}
                      />
                    ))}
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.button
                    onClick={togglePlay}
                    disabled={!ready}
                    whileTap={{ scale: 0.92 }}
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: "spring", stiffness: 450, damping: 25 }}
                    className="grid h-14 w-14 place-items-center rounded-full bg-brand-coral shadow-pop-coral disabled:opacity-50"
                  >
                    {playing ? (
                      <Pause className="h-6 w-6 text-white" />
                    ) : (
                      <Play className="h-6 w-6 text-white" />
                    )}
                  </motion.button>
                </div>
              </div>
              <div dir="ltr" className="relative mt-3">
                <div className="relative h-2 w-full rounded-full bg-muted">
                  <div
                    className="absolute top-0 h-2 rounded-full bg-brand-coral"
                    style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.05}
                  value={currentTime}
                  disabled={!ready}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className="absolute inset-x-0 top-0 h-2 w-full cursor-pointer opacity-0 disabled:cursor-default"
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground font-mono">
                <span>{ready ? formatTime(currentTime) : t("studio.loading")}</span>
                <span>{ready ? formatTime(duration) : ""}</span>
              </div>

              {draft?.videoUrl && (
                <div className="mt-3 border-t border-border pt-3">
                  {replacingCover ? (
                    <div className="space-y-2">
                      <CoverImagePicker
                        coverUrl={draft.coverUrl}
                        coverSubject={draft.songTitle || draft.title}
                        category={draft.category}
                        seed={draftId ?? "video"}
                        onCoverGenerated={(url) =>
                          replaceCoverMutation.mutate({ url, isVideo: false })
                        }
                        onFileUploaded={(result) => replaceCoverMutation.mutate(result)}
                      />
                      <button
                        onClick={() => setReplacingCover(false)}
                        disabled={replaceCoverMutation.isPending}
                        className="press-scale flex w-full items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted-foreground disabled:opacity-40"
                      >
                        <X className="h-3.5 w-3.5" /> {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setReplacingCover(true)}
                      className="press-scale flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2.5 text-sm font-semibold"
                    >
                      <ImageIcon className="h-4 w-4" /> {t("studio.replaceVideoWithCover")}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Right under the scrubber, not buried below the mix/master sections — scrub to the
                spot that needs fixing, open this, and the start marker is already sitting there. */}
            {draft?.rawVocalUrl && !fixSectionOpen && (
              <div className="mt-3">
                <FixSectionToggle onClick={openFixSection} />
              </div>
            )}

            {fixSectionOpen && draft?.rawVocalUrl && (
              <FixSectionEditor
                draftId={draftId!}
                rawVocalUrl={draft.rawVocalUrl}
                backingTrackUrl={draft.backingTrackUrl}
                backingStartOffsetSeconds={draft.backingStartOffsetSeconds}
                videoUrl={draft.videoUrl || undefined}
                vocalGain={mix.vocalVolume / 100}
                backingGain={mix.playbackVolume / 100}
                initialStartFraction={duration > 0 ? currentTime / duration : 0}
                onClose={() => setFixSectionOpen(false)}
                onSaved={(urls) => {
                  queryClient.setQueryData<DraftDTO>(["draft", draftId], (old) =>
                    old ? { ...old, ...urls } : old,
                  );
                  setFixSectionOpen(false);
                }}
              />
            )}

            {/* One action for a finished track: Replicate cleans the take, then our own analysis
                masters it (reverb, balance, loudness…) — see runAiMaster. Manual Mastering below
                is where anything it decided can be overridden by hand. */}
            <section className="mt-5 rounded-3xl border border-accent/40 bg-accent/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-accent">
                <Sparkles className="h-4 w-4" /> {t("studio.cleanupTitle")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("studio.cleanupDesc")}</p>
              {aiMasterBusy ? (
                <ol className="mt-3 space-y-2 rounded-2xl border border-border bg-card/60 p-3">
                  {steps.map((step) => (
                    <li key={step.label}>
                      <div className="flex items-center gap-2 text-sm">
                        {step.state === "done" ? (
                          <Check className="h-4 w-4 shrink-0 text-accent" />
                        ) : step.state === "active" ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                        ) : (
                          <span className="h-4 w-4 shrink-0 rounded-full border border-border" />
                        )}
                        <span className={step.state === "pending" ? "text-muted-foreground" : ""}>
                          {step.label}
                        </span>
                        {step.progress != null && (
                          <span className="ms-auto font-mono text-xs text-accent">
                            {Math.round(step.progress * 100)}%
                          </span>
                        )}
                      </div>
                      {step.detail && (
                        <p className="ms-6 mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                masterReport.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-border bg-card/60 p-3">
                    <p className="text-xs font-semibold text-accent">{t("studio.reportTitle")}</p>
                    <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                      {masterReport.map((line) => (
                        <li key={line} className="flex gap-2">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
              {aiMasterBusy ? null : cleanVocalUrl ? (
                <>
                  {useCleanVocal && (
                    <p className="mt-3 text-xs font-semibold text-accent">
                      {t("studio.cleanupReady")}
                    </p>
                  )}
                  {replicateProof && (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {t("studio.replicateDone", {
                        seconds:
                          replicateProof.predictSeconds != null
                            ? Math.round(replicateProof.predictSeconds)
                            : "?",
                        id: replicateProof.predictionId,
                      })}
                    </p>
                  )}
                  {/* Before/after, not just "on": the only honest way to judge the result on a
                      given take is to flip between the two at the same spot. */}
                  <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-muted p-1 text-xs font-semibold">
                    {[
                      { on: true, label: t("studio.cleanupUseClean") },
                      { on: false, label: t("studio.cleanupUseOriginal") },
                    ].map((opt) => (
                      <button
                        key={String(opt.on)}
                        onClick={() => (opt.on ? runAiMaster() : setUseCleanVocal(false))}
                        disabled={!ready}
                        className={`rounded-full px-3 py-2 transition-colors disabled:opacity-50 ${
                          useCleanVocal === opt.on
                            ? "bg-brand-coral text-white shadow-pop-coral"
                            : "text-muted-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {cleanupError ? (
                    <p className="mt-2 text-xs text-danger">{cleanupError}</p>
                  ) : (
                    cleanupState === "failed" && (
                      <p className="mt-2 text-xs text-danger">{t("studio.cleanupFailed")}</p>
                    )
                  )}
                  <motion.button
                    onClick={runAiMaster}
                    disabled={!ready}
                    whileTap={ready ? { scale: 0.97 } : undefined}
                    whileHover={ready ? { scale: 1.01, y: -1 } : undefined}
                    transition={{ type: "spring", stiffness: 450, damping: 28 }}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-brand-coral py-2.5 text-sm font-bold text-white shadow-pop-coral disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" /> {t("studio.cleanupStart")}
                  </motion.button>
                </>
              )}
            </section>

            <section className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-pop">
              <button
                onClick={() => setManualOpen((v) => !v)}
                className="flex w-full items-center justify-between text-sm font-semibold"
              >
                <span className="flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-accent" /> {t("record.manualEdit")}
                </span>
                {manualOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {manualOpen && (
                <div className="mt-3">
                  {/* Live levels on the separate stems — what you hear is what publish renders.
                      On an already-mixed file there's nothing separate to balance. */}
                  {stems && (
                    <Slider
                      label={t("record.vocalVolume")}
                      v={mix.vocalVolume}
                      onChange={setMixValue("vocalVolume")}
                      min={50}
                      max={200}
                    />
                  )}
                  {stems && sources?.backingUrl && (
                    <Slider
                      label={t("record.playbackVolume")}
                      v={mix.playbackVolume}
                      onChange={setMixValue("playbackVolume")}
                      min={0}
                      max={150}
                    />
                  )}
                  <Slider
                    label={t("record.autotune")}
                    v={autotune}
                    onChange={handleAutotuneChange}
                  />
                  <Slider
                    label={t("record.noise")}
                    v={mix.lowCut + 50}
                    onChange={(hz) => setMixValue("lowCut")(hz - 50)}
                    min={50}
                    max={150}
                    suffix=" Hz"
                  />
                  <Slider
                    label={t("record.mudCut")}
                    v={mix.mudCutDb}
                    onChange={setMixValue("mudCutDb")}
                    max={6}
                    step={0.5}
                    suffix=" dB"
                  />
                  <Slider
                    label={t("record.deEsser")}
                    v={mix.deEss}
                    onChange={setMixValue("deEss")}
                  />
                  <Slider
                    label={t("record.compression")}
                    v={mix.compression}
                    onChange={setMixValue("compression")}
                  />
                  <Slider
                    label={t("record.presence")}
                    v={mix.presenceDb}
                    onChange={setMixValue("presenceDb")}
                    min={-6}
                    max={6}
                    step={0.5}
                    suffix=" dB"
                  />
                  <Slider
                    label={t("record.eq")}
                    v={mix.airDb}
                    onChange={setMixValue("airDb")}
                    min={-6}
                    max={6}
                    step={0.5}
                    suffix=" dB"
                  />
                  <Slider
                    label={t("record.warmth")}
                    v={mix.warmth}
                    onChange={setMixValue("warmth")}
                  />
                  <Slider
                    label={t("record.reverb")}
                    v={mix.reverb}
                    onChange={setMixValue("reverb")}
                  />
                  <Slider
                    label={t("record.reverbSize")}
                    v={mix.reverbSize}
                    onChange={setMixValue("reverbSize")}
                  />
                  <Slider label={t("record.delay")} v={mix.delay} onChange={setMixValue("delay")} />
                  <Slider
                    label={t("record.speed")}
                    v={mix.speed}
                    onChange={setMixValue("speed")}
                    min={50}
                    max={150}
                    suffix="%"
                  />
                </div>
              )}
            </section>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <motion.button
                onClick={() => publishMutation.mutate(false)}
                disabled={!ready || publishMutation.isPending}
                whileTap={!ready || publishMutation.isPending ? undefined : { scale: 0.95 }}
                whileHover={
                  !ready || publishMutation.isPending ? undefined : { scale: 1.03, y: -1 }
                }
                transition={{ type: "spring", stiffness: 450, damping: 28 }}
                className="flex flex-col items-center gap-1 rounded-2xl bg-brand-coral p-3 text-[11px] font-bold text-white shadow-pop-coral disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> {t("common.continueToPublish")}
              </motion.button>
              <button
                onClick={() => publishMutation.mutate(true)}
                disabled={!ready || publishMutation.isPending}
                className="press-scale flex flex-col items-center gap-1 rounded-2xl border border-border bg-card/60 p-3 text-[11px] font-semibold disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> {t("record.sendComp")}
              </button>
            </div>
          </>
        )}
      </div>
      <style>{`.studio-slider { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 999px; background: var(--color-muted); }
      .studio-slider::-webkit-slider-thumb { -webkit-appearance: none; height: 16px; width: 16px; border-radius: 999px; background: var(--brand-coral); box-shadow: var(--shadow-pop); cursor: pointer; transition: transform 0.15s var(--ease-snappy); }
      .studio-slider::-webkit-slider-thumb:active { transform: scale(0.9); }
      .studio-slider::-moz-range-thumb { height: 16px; width: 16px; border: 0; border-radius: 999px; background: var(--brand-coral); box-shadow: var(--shadow-pop); cursor: pointer; }
      .studio-slider::-moz-range-progress { background: color-mix(in oklab, var(--brand-coral) 60%, transparent); border-radius: 999px; }`}</style>
    </AppShell>
  );
}

function Slider({
  label,
  v,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = "%",
}: {
  label: string;
  v: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono text-accent">
          {v}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full studio-slider"
      />
    </div>
  );
}
