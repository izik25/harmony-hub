import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Sliders,
  Wand2,
  Waves,
  Send,
  Play,
  Pause,
  Loader2,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as Tone from "tone";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { getDraft, updateDraftAudio } from "@/functions/posts";
import { smartUploadMedia } from "@/lib/blob-upload";
import {
  processRecording,
  analyzeSignal,
  applyNoiseGate,
  noiseGateThresholdFor,
} from "@/lib/mix-recording";
import { analyzePitch, applyPitchCorrection } from "@/lib/pitch-correct";
import { audioBufferToWavBlob } from "@/lib/wav-encoder";
import { generateImpulseResponse } from "@/lib/impulse-response";
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

type VocalChain = {
  player: Tone.Player;
  filter: Tone.Filter;
  eq3: Tone.EQ3;
  compressor: Tone.Compressor;
  reverbConvolver: Tone.Convolver;
  reverbDry: Tone.Gain;
  reverbWet: Tone.Gain;
  makeupGain: Tone.Gain;
  limiter: Tone.Limiter;
};

type DraftDTO = Awaited<ReturnType<typeof getDraft>>;

type Params = {
  speed: number;
  noise: number;
  reverb: number;
  eq: number;
  compression: number;
  // Post-chain makeup gain, in dB, going into the limiter below — 0 for manual editing, only ever
  // set above 0 by AI Mastering (see applyMaster). This is the piece that used to be missing: EQ,
  // compression, and gating alone can tighten a take up, but none of them make it louder, and
  // "louder" is most of what actually reads as "mastered" versus "the same raw recording."
  gainDb: number;
};

// A hand-generated decaying-noise impulse response (see src/lib/impulse-response.ts) keeps the
// convolution reverb fully synchronous — no async IR generation, which is unsafe to nest inside
// Tone.Offline (used for export/publish) since it swaps the global audio context internally.
function buildChain(onEnded?: () => void): VocalChain {
  const filter = new Tone.Filter({ type: "highpass" });
  const eq3 = new Tone.EQ3();
  const compressor = new Tone.Compressor();

  const rawContext = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const impulse = generateImpulseResponse(rawContext);
  const reverbConvolver = new Tone.Convolver(impulse);
  const reverbDry = new Tone.Gain(1);
  const reverbWet = new Tone.Gain(0);
  const reverbOut = new Tone.Gain(1);
  // Makeup gain + a brickwall limiter as the final stage, after everything else including the
  // reverb send — the limiter's ceiling means gainDb can push a take audibly louder without
  // clipping, instead of every knob above it only ever reshaping the take's dynamics/tone at the
  // same overall loudness it was recorded at.
  const makeupGain = new Tone.Gain(1);
  const limiter = new Tone.Limiter(-0.5).toDestination();

  compressor.fan(reverbDry, reverbConvolver);
  reverbConvolver.connect(reverbWet);
  reverbDry.connect(reverbOut);
  reverbWet.connect(reverbOut);
  reverbOut.chain(makeupGain, limiter);

  const player = onEnded ? new Tone.Player({ onstop: onEnded }) : new Tone.Player();
  player.chain(filter, eq3, compressor);

  return {
    player,
    filter,
    eq3,
    compressor,
    reverbConvolver,
    reverbDry,
    reverbWet,
    makeupGain,
    limiter,
  };
}

function applyParams(chain: VocalChain, p: Params) {
  chain.player.playbackRate = p.speed / 100;
  chain.filter.frequency.value = 80 + (p.noise / 100) * 300;
  const eqDb = ((p.eq - 50) / 50) * 12;
  chain.eq3.low.value = eqDb;
  chain.eq3.high.value = eqDb;
  chain.compressor.threshold.value = -6 - (p.compression / 100) * 30;
  chain.compressor.ratio.value = 1 + (p.compression / 100) * 15;
  // Capped at 0.45 (was 0.7) so even the slider maxed out reads as a small room/plate, not a
  // hall — combined with the shorter impulse response below, this keeps reverb from crossing into
  // audible discrete echo.
  const wetAmt = (p.reverb / 100) * 0.45;
  chain.reverbWet.gain.value = wetAmt;
  chain.reverbDry.gain.value = 1 - wetAmt * 0.5;
  chain.makeupGain.gain.value = Tone.dbToGain(p.gainDb);
}

function disposeChain(chain: VocalChain) {
  chain.player.dispose();
  chain.filter.dispose();
  chain.eq3.dispose();
  chain.compressor.dispose();
  chain.reverbConvolver.dispose();
  chain.reverbDry.dispose();
  chain.reverbWet.dispose();
  chain.makeupGain.dispose();
  chain.limiter.dispose();
}

function StudioPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const draftId = search.draftId;

  // Strength (0-1, shown as 0-100) of the real pitch-correction engine in pitch-correct.ts —
  // analyzePitch/applyPitchCorrection, which measures what was actually sung and resamples toward
  // the nearest note. Defaults to off so a take stays untouched until someone deliberately reaches
  // for it. Dragging this slider bakes correction destructively into the loaded buffer (see
  // runPitchCorrection below) rather than driving a live effect — there's no cheap way to do real
  // per-note pitch tracking in a live Web Audio graph, so unlike the other knobs here this one
  // commits a bit after you stop moving it instead of updating in real time. AI Mastering drives
  // this same slider/engine when it decides a take needs correction (see applyMaster), so this is
  // the one place "how much autotune is on this take" ever lives.
  const [autotune, setA] = useState(0);
  // A light touch, not a hall: 30 through the old 2.5s impulse response read as an audible echo
  // on every take by default, since Studio is where every recording lands after record.tsx.
  const [reverbAmt, setR] = useState(10);
  const [eq, setE] = useState(50);
  const [comp, setC] = useState(30);
  // Defaults to 50 rather than 0 — this is a plain highpass filter for rumble/hum, and it turns
  // out to matter enough for how a take actually sounds that it shouldn't need discovering.
  const [noise, setN] = useState(50);
  const [speed, setSpeed] = useState(100);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  // Whether AI Mastering's noise gate has been baked into the currently-loaded buffer. Read by
  // renderProcessed to reapply the same gate on export/publish's independent offline decode (that
  // decode never sees the live in-memory buffer AI Mastering mutated), and reset whenever a fresh
  // audioUrl loads since a new take hasn't been mastered yet.
  const gateAppliedRef = useRef(false);
  // Strength (0-1) of the destructive pitch correction AI Mastering baked into the currently-loaded
  // buffer, 0 if none was needed/applied. Read by renderProcessed to reapply the same correction on
  // export/publish's independent offline decode, same reasoning as gateAppliedRef above. Reset
  // whenever a fresh audioUrl loads since a new take hasn't been mastered yet.
  const pitchAppliedRef = useRef(0);
  // Post-chain makeup gain (dB) — 0 until AI Mastering sets it (see applyMaster), reset alongside
  // gateAppliedRef whenever a fresh take loads since it hasn't been mastered yet either.
  const [gainDb, setGainDb] = useState(0);

  // 125/85 match record.tsx's initial auto-mix — a touch under the vocal / a touch over the
  // backing track so the instrumental doesn't get buried under it, expressed as % so the sliders
  // read naturally.
  const [vocalVolume, setVocalVolume] = useState(125);
  const [playbackVolume, setPlaybackVolume] = useState(85);
  const [fixSectionOpen, setFixSectionOpen] = useState(false);
  // Whether the "replace video with a cover image" picker is expanded — see replaceCoverMutation.
  const [replacingCover, setReplacingCover] = useState(false);

  const chainRef = useRef<VocalChain | null>(null);
  // Playback position bookkeeping for the scrubber — Tone.Player has no native currentTime/
  // timeupdate the way <audio> does, so position is hand-tracked: positionRef is the source of
  // truth (in buffer seconds), advanced each animation frame by real elapsed time scaled by the
  // live playback rate, and written to directly on seek so dragging and playback never fight.
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  // Untouched copy of the currently-loaded take's channel data, captured once right after decode
  // (see the load effect below) — every destructive pitch-correction pass (runPitchCorrection,
  // applyMaster) restores from this first rather than resampling whatever the buffer currently
  // holds, so repeated adjustments (drag the slider around, or run AI Mastering after already
  // having nudged it manually) always derive fresh from the same clean source instead of compounding
  // correction on top of correction.
  const originalChannelsRef = useRef<Float32Array[] | null>(null);
  // Debounce handle for committing the Autotune slider's drag into the buffer — see
  // runPitchCorrection and the comment by the autotune state above.
  const autotuneCommitTimer = useRef<number | null>(null);
  // Mirrors the DSP slider state without being a dependency of the chain-(re)build effect below —
  // a remix swaps draft.audioUrl and rebuilds the chain from scratch, and it should pick up
  // whatever the sliders are currently set to rather than resetting to Tone's raw defaults.
  const paramsRef = useRef<Params>({
    speed,
    noise,
    reverb: reverbAmt,
    eq,
    compression: comp,
    gainDb,
  });
  useEffect(() => {
    paramsRef.current = {
      speed,
      noise,
      reverb: reverbAmt,
      eq,
      compression: comp,
      gainDb,
    };
  }, [noise, reverbAmt, eq, comp, speed, gainDb]);

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
  // applies pitch correction at the given strength. Updates pitchAppliedRef so renderProcessed's
  // independent offline export re-derives the exact same result on the actual publish/export path.
  const runPitchCorrection = (strength: number) => {
    const chain = chainRef.current;
    const buffer = chain?.player.buffer.get();
    if (!chain || !buffer || !originalChannelsRef.current) return;
    restoreOriginalBuffer(buffer);
    if (gateAppliedRef.current) {
      applyNoiseGate(buffer, noiseGateThresholdFor(analyzeSignal(buffer)));
    }
    const clamped = Math.min(1, Math.max(0, strength));
    if (clamped > 0) applyPitchCorrection(buffer, clamped);
    pitchAppliedRef.current = clamped;
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
    const rate = paramsRef.current.speed / 100;
    positionRef.current = Math.min(positionRef.current + dt * rate, durationRef.current);
    setCurrentTime(positionRef.current);
    if (positionRef.current >= durationRef.current) {
      chainRef.current?.player.stop();
      setPlaying(false);
      stopTicking();
      return;
    }
    rafIdRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (!draft?.audioUrl) return;
    let disposed = false;
    stopTicking();
    setPlaying(false);
    positionRef.current = 0;
    setCurrentTime(0);
    const chain = buildChain();
    chainRef.current = chain;
    gateAppliedRef.current = false;
    pitchAppliedRef.current = 0;
    originalChannelsRef.current = null;
    setGainDb(0);
    setA(0);
    setReady(false);
    const loadWithRetry = async (url: string, attempts = 4): Promise<void> => {
      for (let i = 0; i < attempts; i++) {
        try {
          await chain.player.load(url);
          return;
        } catch (err) {
          if (i === attempts - 1) throw err;
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    };
    loadWithRetry(draft.audioUrl)
      .then(() => {
        if (disposed) return;
        const buf = chain.player.buffer.get();
        if (buf) {
          originalChannelsRef.current = Array.from({ length: buf.numberOfChannels }, (_, ch) =>
            buf.getChannelData(ch).slice(),
          );
        }
        applyParams(chain, paramsRef.current);
        const dur = chain.player.buffer.duration || 0;
        durationRef.current = dur;
        setDuration(dur);
        setReady(true);
      })
      .catch((err) => {
        if (!disposed) toast.error(t("studio.couldNotLoad"));
        console.error(err);
      });
    return () => {
      disposed = true;
      stopTicking();
      if (autotuneCommitTimer.current != null) {
        window.clearTimeout(autotuneCommitTimer.current);
        autotuneCommitTimer.current = null;
      }
      disposeChain(chain);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.audioUrl]);

  useEffect(() => {
    if (!chainRef.current) return;
    applyParams(chainRef.current, {
      speed,
      noise,
      reverb: reverbAmt,
      eq,
      compression: comp,
      gainDb,
    });
  }, [noise, reverbAmt, eq, comp, speed, gainDb]);

  const togglePlay = async () => {
    const chain = chainRef.current;
    if (!chain || !ready) return;
    await Tone.start();
    if (playing) {
      chain.player.stop();
      setPlaying(false);
      stopTicking();
    } else {
      if (positionRef.current >= durationRef.current) {
        positionRef.current = 0;
        setCurrentTime(0);
      }
      chain.player.start(0, positionRef.current);
      setPlaying(true);
      lastFrameRef.current = null;
      rafIdRef.current = requestAnimationFrame(tick);
    }
  };

  // Lets the scrubber move playback to any point without restarting from the top — the whole
  // point being that after tweaking a slider or re-recording a section, you can jump straight
  // back to that spot instead of listening through the entire take again.
  const handleSeek = (value: number) => {
    const chain = chainRef.current;
    if (!chain || !ready) return;
    const clamped = Math.min(Math.max(value, 0), durationRef.current);
    positionRef.current = clamped;
    setCurrentTime(clamped);
    lastFrameRef.current = null;
    chain.player.seek(clamped);
  };

  // Stops the main preview before opening Fix a Section — two audio sources (this one plus its
  // own internal <audio> for the raw vocal) shouldn't ever play at once — and hands it the
  // scrubber's current position so the fix's start marker is already sitting where you were
  // listening instead of at 0.
  const openFixSection = () => {
    const chain = chainRef.current;
    if (chain && playing) {
      chain.player.stop();
      setPlaying(false);
      stopTicking();
    }
    setFixSectionOpen(true);
  };

  const renderProcessed = async (): Promise<Blob> => {
    const chain = chainRef.current;
    if (!chain || !ready || !draft?.audioUrl) throw new Error(t("studio.loadTrackFirst"));
    const sourceDuration = chain.player.buffer.duration;
    const duration = sourceDuration / (speed / 100) + 0.3;
    const params: Params = {
      speed,
      noise,
      reverb: reverbAmt,
      eq,
      compression: comp,
      gainDb,
    };
    const audioUrl = draft.audioUrl;
    const gateApplied = gateAppliedRef.current;
    const pitchStrength = pitchAppliedRef.current;

    const rendered = await Tone.Offline(
      async () => {
        const offlineChain = buildChain();
        // Re-decode fresh in the offline context rather than reusing the live AudioContext's
        // buffer — Chromium can silently stall OfflineAudioContext rendering when a source node
        // references an AudioBuffer decoded by a different context.
        await offlineChain.player.load(audioUrl);
        // This decode is independent of the live buffer AI Mastering gated/retuned in place —
        // reapply the same gate and pitch correction here so export/publish actually carries them,
        // not just the slider values. Deterministic: same source audio in both places always
        // analyzes and detects pitch the same way.
        if (gateApplied || pitchStrength > 0) {
          const offlineBuffer = offlineChain.player.buffer.get();
          if (offlineBuffer) {
            if (gateApplied) {
              applyNoiseGate(offlineBuffer, noiseGateThresholdFor(analyzeSignal(offlineBuffer)));
            }
            if (pitchStrength > 0) {
              applyPitchCorrection(offlineBuffer, pitchStrength);
            }
          }
        }
        applyParams(offlineChain, params);
        offlineChain.player.start(0);
      },
      duration,
      // Mono — the source is a solo vocal take, so rendering to stereo would just double the
      // exported WAV's byte size (and the risk of tripping a request-body size limit) for no
      // audible benefit.
      1,
    );

    const audioBuffer = rendered.get();
    if (!audioBuffer) throw new Error(t("studio.exportFailed"));
    return audioBufferToWavBlob(audioBuffer);
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

  // Re-bakes the vocal/backing balance from the original stems (kept around from record.tsx as
  // rawVocalUrl/backingTrackUrl) at a new gain balance, without re-recording. Same offline
  // pipeline record.tsx used to run itself — just relocated here so it lives alongside every
  // other knob instead of being a separate step before Studio even opens.
  const remixMutation = useMutation({
    mutationFn: async () => {
      if (!draftId || !draft?.rawVocalUrl) throw new Error(t("studio.nothingToPublish"));
      const rawBlob = await fetch(draft.rawVocalUrl).then((r) => r.blob());
      const mixed = await processRecording(rawBlob, draft.backingTrackUrl || undefined, {
        vocalGain: vocalVolume / 100,
        backingGain: playbackVolume / 100,
      });
      const { url } = await smartUploadMedia(mixed, `studio-remix-${Date.now()}.wav`);
      await updateDraftAudio({ data: { id: draftId, audioUrl: url } });
      return url;
    },
    onSuccess: (url) => {
      queryClient.setQueryData<DraftDTO>(["draft", draftId], (old) =>
        old ? { ...old, audioUrl: url } : old,
      );
      toast.success(t("studio.remixedToast"));
    },
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

  // The one-tap "get me as close to a finished studio vocal as possible" pass. Runs analyzeSignal
  // (mix-recording.ts) on whatever's actually loaded first — this take's own noise floor, dynamic
  // range, and rough tonal brightness — so it can tell an already-clean take from a noisy one
  // instead of processing every recording identically:
  //  - already studio-clean (quiet floor + wide dynamic range): the noise gate is skipped
  //    entirely — running it on a take with no noise to remove just risks chopping quiet
  //    syllables — and only a light EQ/compression polish is applied.
  //  - anything noisier: the same destructive gate processRecording uses (applyNoiseGate) runs
  //    directly on the loaded buffer, actually removing the room/hiss between phrases rather than
  //    just raising the highpass slider, and the reverb send is pulled down (not up) since a
  //    noisy/live room already carries its own ambience.
  // Reverb in particular is capped well under the manual slider's own ceiling either way, so
  // "AI Mastering" always reads as tightening a take up, never adding more room on top of it. On
  // top of the gate/EQ/compression/reverb tightening, it also pushes the take's overall loudness
  // up toward a real mastered level through makeupGain + a limiter (see gainBoostDb below) — the
  // one part of "mastering" that reshaping dynamics/tone alone can never produce on its own.
  const applyMaster = () => {
    const chain = chainRef.current;
    const buffer = chain?.player.buffer.get();
    if (!chain || !buffer) {
      toast.error(t("studio.loadTrackFirst"));
      return;
    }
    // A pending manual Autotune drag shouldn't land after Master has already re-derived its own
    // correction strength below, and Master's own analysis should always read the untouched take
    // regardless of whatever's already been baked in from a previous manual nudge — restoring
    // first makes this call idempotent no matter what state the buffer was already in.
    if (autotuneCommitTimer.current != null) {
      window.clearTimeout(autotuneCommitTimer.current);
      autotuneCommitTimer.current = null;
    }
    restoreOriginalBuffer(buffer);
    const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));

    const before = analyzeSignal(buffer);
    const dynamicRangeDb = before.vocalLevelDb - before.noiseFloorDb;
    const alreadyExcellent = before.noiseFloorDb <= -42 && dynamicRangeDb >= 20;

    if (!alreadyExcellent) {
      applyNoiseGate(buffer, noiseGateThresholdFor(before));
    }
    gateAppliedRef.current = !alreadyExcellent;

    // Re-measure after gating — the gate itself lowers the noise floor, and the knobs below
    // should react to what the take sounds like now, not what it sounded like before cleanup.
    const after = alreadyExcellent ? before : analyzeSignal(buffer);
    const afterDynamicRangeDb = after.vocalLevelDb - after.noiseFloorDb;

    // Noisier room (higher noise floor) → lean harder on the highpass; an already-clean take
    // gets to keep more of its low end.
    const noiseAmt = clamp(((after.noiseFloorDb + 55) / 30) * 100, 35, 85);
    // Wider gap between the quiet and loud parts of the performance → more compression to even
    // it out; an already-consistent take doesn't need it pushed as hard.
    const compAmt = clamp(((afterDynamicRangeDb - 12) / 23) * 100, 35, 85);
    // Duller-sounding take gets pushed brighter; an already-bright one is left closer to flat
    // instead of getting pushed further and turning harsh. Slope is calibrated so brightness's
    // real-world range (per analyzeSignal's own "0 dull to 0.5+ airy" doc comment) lands mid-clamp
    // instead of pinning: the old `70 - brightness*90` reached the 40 floor for any brightness
    // above ~0.33, which most real vocal takes clear, so Master was silently setting the same EQ
    // value on almost every take — this is why the slider looked like it "didn't move at all."
    // brightness=0 (very dull) now lands near 65, brightness=0.5 (per the docstring's own "airy"
    // reference point) lands at 50 (flat, matching the "left closer to flat" intent above), only
    // pinning to the 40 floor for genuinely harsh/bright outliers past ~0.83.
    const eqAmt = clamp(65 - after.brightness * 30, 40, 68);
    // A produced, "finished record" vocal reads as sitting in a real space, not bone dry — a
    // noticeable send by default rather than the barely-there touch this used to cap out at. A
    // noisy/live room still gets pulled down toward the low end of the range since it already
    // carries its own room ambience and doesn't need more piled on top; a clean, dry capture gets
    // the full send since it has no ambience of its own to clash with.
    const reverbAmt = clamp(55 - (after.noiseFloorDb + 55) * 0.86, 25, 55);

    // The piece that actually makes mastering audible: push the take up toward a real "finished
    // record" loudness rather than just reshaping its dynamics/tone at the level it happened to be
    // recorded at. -12dB is meaningfully hotter than the -20dB target record.tsx's own auto-gain
    // already normalized every take to (see processRecording in mix-recording.ts) — without this,
    // AI Mastering was re-deriving a level the take had already arrived at, which is exactly why it
    // could land on barely-perceptible knob movements for an already-decent take. Boost-only
    // (floored at 0) so a hot take never gets turned down by hitting Master, and capped at 9dB so
    // the limiter (buildChain, threshold -0.5dB) only ever has a sane amount of gain reduction to
    // do, not enough to audibly squash the take.
    const targetMasterDb = -12;
    const gainBoostDb = clamp(targetMasterDb - after.vocalLevelDb, 0, 9);

    // Drives the same Autotune slider/engine a manual adjustment would (see runPitchCorrection
    // above) — Master just decides a sensible strength on the take's behalf instead of leaving it
    // at wherever the user last left the slider. Measure how far this take's sung pitch actually
    // drifts from the nearest note first (analyzePitch is detection-only, much
    // cheaper than the full correction pass), then only pay for applyPitchCorrection's resampling
    // when there's both enough sustained singing to correct (voicedRatio) and a real, audible drift
    // to correct (avgAbsCents, gated above single-frame detection noise) — an already in-tune or
    // mostly-spoken take is left untouched rather than run through resampling for no gain. Strength
    // scales with how far off it actually is, so a barely-flat phrase gets pulled in gently and a
    // properly off-key one gets pulled in harder, instead of one fixed correction amount applied
    // regardless of need. Capped at 0.7 rather than fully snapping (1.0): applyPitchCorrection's
    // resample-and-OLA shifter still has some inherent character at high strength on a held note,
    // so this stops short of the last stretch where "in tune" starts costing more than it's worth.
    const pitchProfile = analyzePitch(buffer);
    const clamp01 = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    let pitchStrength = 0;
    if (pitchProfile.voicedRatio > 0.2 && pitchProfile.avgAbsCents > 12) {
      pitchStrength = clamp01(0.3 + (pitchProfile.avgAbsCents / 150) * 0.4, 0.3, 0.7);
      applyPitchCorrection(buffer, pitchStrength);
    }
    pitchAppliedRef.current = pitchStrength;
    setA(Math.round(pitchStrength * 100));

    setN(noiseAmt);
    setR(reverbAmt);
    setE(eqAmt);
    setC(compAmt);
    setGainDb(gainBoostDb);
    const baseMsg = alreadyExcellent
      ? t("studio.masterAppliedClean")
      : t("studio.masterAppliedCleaned");
    toast.success(
      pitchStrength > 0 ? `${baseMsg} ${t("studio.masterAppliedPitchSuffix")}` : baseMsg,
    );
  };

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
          <div className="mt-6 rounded-3xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-pop">
            {t("studio.noTrack")}{" "}
            <Link to="/record" className="text-accent underline">
              {t("studio.record")}
            </Link>{" "}
            {t("studio.or")}{" "}
            <Link to="/upload" search={{}} className="text-accent underline">
              {t("studio.upload")}
            </Link>{" "}
            {t("studio.oneFirst")}
          </div>
        ) : (
          <>
            {/* A camera-recorded (or manually uploaded) performance video — the underlying take
                still carries a normal audioUrl/rawVocalUrl (see finishMutation in record.tsx and
                the video-aware Fix a Section save below), so the full DSP/Mastering/Fix-a-Section
                UI further down still applies to it exactly like any audio-only draft. This card
                just previews the video and lets it be swapped for a still cover image. */}
            {draft?.videoUrl && (
              <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-card shadow-pop">
                <video
                  src={draft.videoUrl}
                  controls
                  playsInline
                  className="aspect-[9/16] w-full bg-black object-contain"
                />
                <div className="p-3">
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
              </div>
            )}

            <div className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-pop">
              <div className="relative h-24 overflow-hidden rounded-xl bg-muted">
                <div className="absolute inset-0 flex items-center justify-around px-2">
                  {Array.from({ length: 60 }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-0.5 rounded-full ${BRAND_BAR_COLORS[i % BRAND_BAR_COLORS.length]}`}
                      style={{ height: `${12 + Math.abs(Math.sin(i / 3)) * 60}%` }}
                    />
                  ))}
                </div>
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
                videoUrl={draft.videoUrl || undefined}
                vocalGain={vocalVolume / 100}
                backingGain={playbackVolume / 100}
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

            {draft?.rawVocalUrl && (
              <section className="mt-5 rounded-3xl border border-border bg-card p-4 shadow-pop">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Sliders className="h-4 w-4 text-accent" /> {t("record.mixBalance")}
                </h2>
                <Slider
                  label={t("record.vocalVolume")}
                  v={vocalVolume}
                  onChange={setVocalVolume}
                  min={50}
                  max={200}
                />
                {draft.backingTrackUrl && (
                  <Slider
                    label={t("record.playbackVolume")}
                    v={playbackVolume}
                    onChange={setPlaybackVolume}
                    min={0}
                    max={150}
                  />
                )}
                <button
                  onClick={() => remixMutation.mutate()}
                  disabled={remixMutation.isPending}
                  className="press-scale mt-1 flex w-full items-center justify-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-semibold text-accent disabled:opacity-40"
                >
                  {remixMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  {t("record.remix")}
                </button>
              </section>
            )}

            <section className="mt-5 rounded-3xl border border-accent/40 bg-accent/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-accent">
                <Waves className="h-4 w-4" /> {t("studio.masteringPreset")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("studio.masteringDesc")}</p>
              <motion.button
                onClick={applyMaster}
                whileTap={{ scale: 0.97 }}
                whileHover={{ scale: 1.01, y: -1 }}
                transition={{ type: "spring", stiffness: 450, damping: 28 }}
                className="mt-3 w-full rounded-full bg-brand-coral py-2.5 text-sm font-bold text-white shadow-pop-coral"
              >
                {t("record.master")}
              </motion.button>
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
                  <Slider
                    label={t("record.autotune")}
                    v={autotune}
                    onChange={handleAutotuneChange}
                  />
                  <Slider label={t("record.noise")} v={noise} onChange={setN} />
                  <Slider label={t("record.reverb")} v={reverbAmt} onChange={setR} />
                  <Slider label={t("record.eq")} v={eq} onChange={setE} />
                  <Slider label={t("record.compression")} v={comp} onChange={setC} />
                  <Slider
                    label={t("record.speed")}
                    v={speed}
                    onChange={setSpeed}
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
  suffix = "%",
}: {
  label: string;
  v: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
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
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full studio-slider"
      />
    </div>
  );
}
