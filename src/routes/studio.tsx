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
import { analyzeSong, NOTE_NAMES, type SongAnalysis } from "@/lib/song-analysis";
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

// True peak, not RMS — vocalLevelDb (analyzeSignal) is an 85th-percentile short-window RMS
// measure, and vocal takes routinely have a 10dB+ crest factor, so a take that reads e.g. -18dB
// RMS can already have peaks sitting right under 0dBFS. applyMaster used to size its makeup-gain
// boost off vocalLevelDb alone, with no idea how much real headroom the take had left — see the
// comment by gainBoostDb below for why that's what was actually causing AI Mastering to distort.
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
// the backing track lands on top of it. The backing is downmixed (L+R)/2, matching the mono export.
function peakDbOfMix(
  vocal: AudioBuffer,
  vocalLevel: number,
  backing: AudioBuffer | null,
  backingLevel: number,
): number {
  if (!backing) return peakDbOf(vocal) + 20 * Math.log10(vocalLevel || 1e-6);
  const v = vocal.getChannelData(0);
  const left = backing.getChannelData(0);
  const right = backing.numberOfChannels > 1 ? backing.getChannelData(1) : left;
  const n = Math.min(v.length, left.length);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const abs = Math.abs(v[i] * vocalLevel + ((left[i] + right[i]) / 2) * backingLevel);
    if (abs > peak) peak = abs;
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

type VocalChain = {
  /** The vocal stem — every DSP knob, AI Mastering's gate, and pitch correction act on this alone. */
  player: Tone.Player;
  /** The aligned backing stem (see prepareStems), mixed in after the vocal's processing, never
   * through it. Left unloaded for drafts with no separate stems. */
  backingPlayer: Tone.Player;
  filter: Tone.Filter;
  /** Peaking cut around 300Hz — the boxy/muddy band on a close-miked voice. */
  mud: Tone.Filter;
  /** Peaking boost around 3kHz — where words become intelligible over the music. */
  presence: Tone.Filter;
  eq3: Tone.EQ3;
  compressor: Tone.Compressor;
  reverbSendHighpass: Tone.Filter;
  reverbSendLowpass: Tone.Filter;
  reverbConvolver: Tone.Convolver;
  reverbDry: Tone.Gain;
  reverbWet: Tone.Gain;
  reverbOut: Tone.Gain;
  vocalLevel: Tone.Gain;
  backingLevel: Tone.Gain;
  makeupGain: Tone.Gain;
  limiter: Tone.Compressor;
};

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

type Params = {
  speed: number;
  noise: number;
  reverb: number;
  eq: number;
  compression: number;
  /** dB at ~3kHz, negative to soften. */
  presenceDb: number;
  /** dB cut at ~300Hz, 0 or positive. */
  mudCutDb: number;
  /** 0-100 → reverb tail length (see reverbTailSeconds). */
  reverbSize: number;
  /** Reverb pre-delay in seconds — timed to the song's tempo by AI mastering. */
  preDelay: number;
  // Post-chain makeup gain, in dB, going into the limiter below — 0 for manual editing, only ever
  // set above 0 by AI Mastering (see applyMaster). This is the piece that used to be missing: EQ,
  // compression, and gating alone can tighten a take up, but none of them make it louder, and
  // "louder" is most of what actually reads as "mastered" versus "the same raw recording."
  gainDb: number;
  /** Linear stem levels from the Mix Balance sliders — live, no re-render needed. */
  vocalLevel: number;
  backingLevel: number;
};

// A hand-generated decaying-noise impulse response (see src/lib/impulse-response.ts) keeps the
// convolution reverb fully synchronous — no async IR generation, which is unsafe to nest inside
// Tone.Offline (used for export/publish) since it swaps the global audio context internally.
//
// Signal flow: vocal → highpass → EQ → compressor → (dry + filtered reverb send) → vocal level ─┐
//              backing → backing level ──────────────────────────────────────────────────────────┴→ makeup gain → limiter
// The backing used to be baked into the one file this whole chain processed, so the reverb, gate,
// compressor and even pitch correction were all running over the drums and the instrumental too —
// reverb on a full mix is a wash of echo no matter how short the tail, which is a big part of
// what read as "too much echo".
const reverbTailSeconds = (size: number) => 0.6 + (size / 100) * 1.8;

// Which impulse response each chain's convolver currently holds — not a field on VocalChain
// itself, since disposeChain disposes every field.
const impulseKeys = new WeakMap<VocalChain, string>();

function buildChain(): VocalChain {
  const filter = new Tone.Filter({ type: "highpass" });
  const mud = new Tone.Filter({ type: "peaking", frequency: 300, Q: 1.2, gain: 0 });
  const presence = new Tone.Filter({ type: "peaking", frequency: 3200, Q: 0.9, gain: 0 });
  const eq3 = new Tone.EQ3();
  const compressor = new Tone.Compressor();

  const rawContext = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const impulse = generateImpulseResponse(rawContext);
  // The send is band-limited before it reaches the convolver — the standard vocal-reverb move.
  // Reverberated lows are what make a tail boomy/muddy and read as a second, distant copy of the
  // voice; reverberated top end turns every "s" into a hissy splash. 400Hz-7kHz keeps the sheen
  // and drops both.
  const reverbSendHighpass = new Tone.Filter({ type: "highpass", frequency: 400 });
  const reverbSendLowpass = new Tone.Filter({ type: "lowpass", frequency: 7000 });
  const reverbConvolver = new Tone.Convolver(impulse);
  const reverbDry = new Tone.Gain(1);
  const reverbWet = new Tone.Gain(0);
  const reverbOut = new Tone.Gain(1);
  const vocalLevel = new Tone.Gain(1);
  const backingLevel = new Tone.Gain(1);
  // Makeup gain + a brickwall limiter as the final stage, after everything else including the
  // backing — the limiter's ceiling means gainDb can push a take audibly louder without clipping.
  //
  // Built by hand instead of Tone.Limiter: Tone.Limiter hardcodes its release at 10ms, and
  // anything under ~50ms makes a limiter start tracking the waveform of the audio itself rather
  // than its envelope — audible as added distortion/pumping, exactly what AI Mastering was
  // producing whenever gainDb pushed much gain into it. Release matches mix-recording.ts's limiter.
  const makeupGain = new Tone.Gain(1);
  const limiter = new Tone.Compressor({
    ratio: 20,
    attack: 0.003,
    release: 0.1,
    threshold: -1,
  }).toDestination();

  compressor.fan(reverbDry, reverbSendHighpass);
  reverbSendHighpass.chain(reverbSendLowpass, reverbConvolver, reverbWet);
  reverbDry.connect(reverbOut);
  reverbWet.connect(reverbOut);
  reverbOut.chain(vocalLevel, makeupGain);
  makeupGain.connect(limiter);

  const player = new Tone.Player();
  player.chain(filter, mud, presence, eq3, compressor);
  const backingPlayer = new Tone.Player();
  backingPlayer.chain(backingLevel, makeupGain);

  return {
    player,
    backingPlayer,
    filter,
    mud,
    presence,
    eq3,
    compressor,
    reverbSendHighpass,
    reverbSendLowpass,
    reverbConvolver,
    reverbDry,
    reverbWet,
    reverbOut,
    vocalLevel,
    backingLevel,
    makeupGain,
    limiter,
  };
}

function applyParams(chain: VocalChain, p: Params) {
  chain.player.playbackRate = p.speed / 100;
  chain.backingPlayer.playbackRate = p.speed / 100;
  // 50-150Hz rumble cut, not 80-380Hz: the old ceiling ran well into a lot of voices' actual
  // fundamental range, thinning the take out under the guise of "removing noise."
  chain.filter.frequency.value = 50 + (p.noise / 100) * 100;
  chain.mud.gain.value = -p.mudCutDb;
  chain.presence.gain.value = p.presenceDb;
  // A tilt, not a parallel boost: brighter now means lift the top and trim the bottom (roughly
  // equal-and-opposite, standard mastering "tilt EQ"), instead of pushing low and high by the same
  // +/-12dB at once, which just made the take louder and boxier rather than actually brighter —
  // and at the top of the old range was enough gain on its own to push the limiter into distortion.
  const eqDb = ((p.eq - 50) / 50) * 8;
  chain.eq3.high.value = eqDb;
  chain.eq3.low.value = -eqDb * 0.5;
  // Threshold/ratio brought down into the range real mastering compression actually uses (mild
  // 2-4:1, up to ~6:1 for a heavy setting) instead of maxing out at -36dB/16:1, which was closer to
  // a second limiter than a compressor and squashed takes hard enough to read as distortion/pumping
  // once makeup gain and the final limiter (see buildChain) piled on top of it.
  chain.compressor.threshold.value = -4 - (p.compression / 100) * 16;
  chain.compressor.ratio.value = 1 + (p.compression / 100) * 5;
  // Capped at 0.35 so even the slider maxed out reads as a short plate behind the voice, never a
  // hall — the dry level barely dips, so the voice itself always stays up front.
  const wetAmt = (p.reverb / 100) * 0.35;
  chain.reverbWet.gain.value = wetAmt;
  // Regenerated only when size/pre-delay actually change — and in whatever context is current,
  // so Tone.Offline's export builds its own instead of borrowing the live context's buffer.
  const irKey = `${p.reverbSize}|${p.preDelay}`;
  if (impulseKeys.get(chain) !== irKey) {
    impulseKeys.set(chain, irKey);
    const context = Tone.getContext().rawContext as unknown as BaseAudioContext;
    chain.reverbConvolver.buffer = new Tone.ToneAudioBuffer(
      generateImpulseResponse(context, reverbTailSeconds(p.reverbSize), 3.6, p.preDelay),
    );
  }
  chain.reverbDry.gain.value = 1 - wetAmt * 0.3;
  chain.vocalLevel.gain.value = p.vocalLevel;
  chain.backingLevel.gain.value = p.backingLevel;
  chain.makeupGain.gain.value = Tone.dbToGain(p.gainDb);
}

// Both stems always start/stop/seek together on one shared timestamp — they're the same length
// and already aligned (prepareStems), so a single position drives both.
function startChain(chain: VocalChain, offset: number) {
  const at = Tone.now() + 0.02;
  chain.player.start(at, offset);
  if (chain.backingPlayer.loaded) chain.backingPlayer.start(at, offset);
}

function stopChain(chain: VocalChain) {
  chain.player.stop();
  if (chain.backingPlayer.loaded) chain.backingPlayer.stop();
}

function seekChain(chain: VocalChain, offset: number) {
  const at = Tone.now() + 0.02;
  chain.player.seek(offset, at);
  if (chain.backingPlayer.loaded) chain.backingPlayer.seek(offset, at);
}

function disposeChain(chain: VocalChain) {
  for (const node of Object.values(chain)) node.dispose();
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
  const [presence, setPresence] = useState(0);
  const [mudCut, setMudCut] = useState(0);
  // 22 ≈ the 1s plate impulse-response.ts was tuned around.
  const [reverbSize, setReverbSize] = useState(22);
  const [preDelay, setPreDelay] = useState(0.03);
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
  // The song's scale (from analyzeSong) that pitch correction aims at — undefined until AI
  // mastering has detected a confident key for this take, which means "nearest semitone".
  const pitchScaleRef = useRef<number[] | undefined>(undefined);
  // Post-chain makeup gain (dB) — 0 until AI Mastering sets it (see applyMaster), reset alongside
  // gateAppliedRef whenever a fresh take loads since it hasn't been mastered yet either.
  const [gainDb, setGainDb] = useState(0);

  // 115/95 match record.tsx's initial auto-mix — a touch under the vocal / a touch over the
  // backing track so the instrumental doesn't get buried under it, expressed as % so the sliders
  // read naturally.
  const [vocalVolume, setVocalVolume] = useState(115);
  const [playbackVolume, setPlaybackVolume] = useState(95);
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
  // (see the load effect below) — every destructive pitch-correction pass (runPitchCorrection,
  // applyMaster) restores from this first rather than resampling whatever the buffer currently
  // holds, so repeated adjustments (drag the slider around, or run AI Mastering after already
  // having nudged it manually) always derive fresh from the same clean source instead of compounding
  // correction on top of correction.
  const originalChannelsRef = useRef<Float32Array[] | null>(null);
  // Debounce handle for committing the Autotune slider's drag into the buffer — see
  // runPitchCorrection and the comment by the autotune state above.
  const autotuneCommitTimer = useRef<number | null>(null);
  // What the chain is playing — see the stems effect below. null while stems are being prepared.
  const [sources, setSources] = useState<Sources | null>(null);
  const stems = sources?.stems ?? false;
  const currentParams: Params = {
    speed,
    noise,
    reverb: reverbAmt,
    eq,
    compression: comp,
    presenceDb: presence,
    mudCutDb: mudCut,
    reverbSize,
    preDelay,
    gainDb,
    // On an already-mixed file (no stems) there's nothing separate to balance — the volume
    // sliders aren't shown, and the mix passes through at unity.
    vocalLevel: stems ? vocalVolume / 100 : 1,
    backingLevel: playbackVolume / 100,
  };
  // Mirrors the DSP slider state without being a dependency of the chain-(re)build effect below —
  // a Fix a Section save swaps the stems and rebuilds the chain from scratch, and it should pick
  // up whatever the sliders are currently set to rather than resetting to Tone's raw defaults.
  const paramsRef = useRef<Params>(currentParams);
  useEffect(() => {
    paramsRef.current = currentParams;
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
    if (clamped > 0) applyPitchCorrection(buffer, clamped, pitchScaleRef.current);
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
  const [masterStage, setMasterStage] = useState<"idle" | "analyzing" | "mastering" | "done">(
    "idle",
  );
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
        { vocalGain: 1, backingStartOffsetSeconds: draft.backingStartOffsetSeconds },
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
    pitchAppliedRef.current = 0;
    pitchScaleRef.current = undefined;
    masterRunRef.current++;
    setMasterStage("idle");
    setMasterReport([]);
    originalChannelsRef.current = null;
    setGainDb(0);
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
        applyParams(chain, paramsRef.current);
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
    applyParams(chainRef.current, currentParams);
    if (draftVideoRef.current) draftVideoRef.current.playbackRate = speed / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    noise,
    presence,
    mudCut,
    reverbAmt,
    reverbSize,
    preDelay,
    eq,
    comp,
    speed,
    gainDb,
    vocalVolume,
    playbackVolume,
    stems,
  ]);

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

  const renderProcessed = async (): Promise<Blob> => {
    const chain = chainRef.current;
    if (!chain || !ready || !sources) throw new Error(t("studio.loadTrackFirst"));
    const sourceDuration = chain.player.buffer.duration;
    const duration = sourceDuration / (speed / 100) + 0.3;
    const params = currentParams;
    const { vocalUrl, backingUrl } = sources;
    const gateApplied = gateAppliedRef.current;
    const pitchStrength = pitchAppliedRef.current;
    const pitchScale = pitchScaleRef.current;

    const rendered = await Tone.Offline(
      async () => {
        const offlineChain = buildChain();
        // Re-decode fresh in the offline context rather than reusing the live AudioContext's
        // buffer — Chromium can silently stall OfflineAudioContext rendering when a source node
        // references an AudioBuffer decoded by a different context.
        await Promise.all([
          offlineChain.player.load(vocalUrl),
          backingUrl ? offlineChain.backingPlayer.load(backingUrl) : null,
        ]);
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
              applyPitchCorrection(offlineBuffer, pitchStrength, pitchScale);
            }
          }
        }
        applyParams(offlineChain, params);
        offlineChain.player.start(0);
        if (backingUrl) offlineChain.backingPlayer.start(0);
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

  // The mastering half of AI Cleanup & Mastering — nothing here is a preset. analyzeSong
  // (song-analysis.ts) first measures this song and this take: key, tempo, the vocal's and the
  // backing's spectrum band by band, how busy the arrangement is, how unevenly the take was sung.
  // analyzePitch then measures the sung range and how far it drifts from the song's own scale.
  // Every knob below is derived from those measurements, and each decision is reported back as a
  // line in masterReport, so the user sees what was heard and why it was changed — and anything
  // that measured fine is left alone rather than processed for the sake of it.
  //
  // Spectral targets are spectral-density differences (dB per FFT bin) against the vocal's own
  // 500Hz-2kHz body, approximating a finished, well-mixed lead vocal — first calibrated against
  // real phone takes from this app (which measured mud ≈ +8-11, presence ≈ −13, air ≈ −13-19 on
  // those scales). They're the calibration knobs of this engine: tune them by ear on real takes.
  const applyMaster = async ({ announce }: { announce: boolean }) => {
    const chain = chainRef.current;
    const buffer = chain?.player.buffer.get();
    if (!chain || !buffer) {
      toast.error(t("studio.loadTrackFirst"));
      return;
    }
    const run = ++masterRunRef.current;
    const stale = () => run !== masterRunRef.current || chainRef.current !== chain;
    // A pending manual Autotune drag shouldn't land after this has re-derived its own correction,
    // and the analysis should always read the untouched take — restoring first makes the whole
    // run idempotent no matter what state the buffer was already in.
    if (autotuneCommitTimer.current != null) {
      window.clearTimeout(autotuneCommitTimer.current);
      autotuneCommitTimer.current = null;
    }
    setMasterStage("analyzing");
    setAnalysisProgress(0);
    setMasterReport([]);
    restoreOriginalBuffer(buffer);
    const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
    const clampF = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const isClean = !!sources?.cleanVocal;
    const report: string[] = [];

    // The model already took the noise out of a cleaned take; gating it again would only risk
    // chopping quiet syllables. A raw take gets the same destructive gate processRecording uses,
    // unless it's already studio-quiet.
    const before = analyzeSignal(buffer);
    const gate =
      !isClean && !(before.noiseFloorDb <= -42 && before.vocalLevelDb - before.noiseFloorDb >= 20);
    if (gate) {
      applyNoiseGate(buffer, noiseGateThresholdFor(before));
      report.push(t("studio.reportGate"));
    }
    gateAppliedRef.current = gate;
    const after = gate ? analyzeSignal(buffer) : before;

    const backingBuffer =
      stems && chain.backingPlayer.loaded ? (chain.backingPlayer.buffer.get() ?? null) : null;
    let song: SongAnalysis;
    try {
      song = await analyzeSong(buffer, backingBuffer, (f) => {
        if (!stale()) setAnalysisProgress(f);
      });
    } catch (err) {
      console.error(err);
      if (!stale()) setMasterStage("idle");
      toast.error(t("studio.masterFailed"));
      return;
    }
    if (stale()) return;
    setMasterStage("mastering");
    // Let the step list repaint before the synchronous pitch passes below.
    await new Promise((r) => setTimeout(r, 0));
    if (stale()) return;
    const v = song.vocal.bands;
    const density = song.backing?.density ?? 0.5;

    // Pitch, against the song's own key when it's clear enough to trust. Measure first (detection
    // only), and only pay for the resampling pass when there's sustained singing and a real drift:
    // 30 cents sits outside normal vibrato, which alone swings ±50-100 cents around a note and
    // averages out far lower. Strength scales with how far off it is, capped at 0.7 so a held note
    // never picks up the shifter's character at full snap.
    const scale = song.key && song.key.confidence >= 0.6 ? song.key.scale : undefined;
    pitchScaleRef.current = scale;
    const pitchProfile = analyzePitch(buffer, scale);
    if (song.key) {
      const keyName = `${NOTE_NAMES[song.key.tonic]} ${t(song.key.mode === "major" ? "studio.modeMajor" : "studio.modeMinor")}`;
      report.push(t(scale ? "studio.reportKeyScale" : "studio.reportKey", { key: keyName }));
    }
    let pitchStrength = 0;
    if (pitchProfile.voicedRatio > 0.2 && pitchProfile.avgAbsCents > 30) {
      pitchStrength = clampF(0.15 + (pitchProfile.avgAbsCents / 220) * 0.55, 0.15, 0.7);
      applyPitchCorrection(buffer, pitchStrength, scale);
      report.push(t("studio.reportPitchFixed", { cents: Math.round(pitchProfile.avgAbsCents) }));
    } else if (pitchProfile.voicedRatio > 0.2) {
      report.push(t("studio.reportPitchOk"));
    }
    pitchAppliedRef.current = pitchStrength;

    // Low cut just under the lowest note actually sung, so it takes rumble and handling noise
    // without ever thinning the voice itself; a raw take in a noisy room leans on it harder, but
    // still never above 80% of that lowest note.
    const lowHz = pitchProfile.lowHz;
    const ceilingHz = lowHz ? Math.min(150, lowHz * 0.8) : 150;
    const roomHz = isClean ? 50 : 50 + clampF(((after.noiseFloorDb + 55) / 30) * 100, 0, 85);
    const lowCutHz = clamp(
      Math.max(lowHz ? lowHz * 0.6 : 80, Math.min(roomHz, ceilingHz)),
      50,
      150,
    );
    report.push(t("studio.reportLowCut", { hz: lowCutHz }));

    // Vocal/playback balance from measured levels, not defaults: the vocal's loud passages sit a
    // little over the backing's (analyzeSignal's 85th-percentile level), by more for a dense,
    // wall-to-wall arrangement than for a sparse one. Playback stays near its default and the
    // vocal moves; playback only gives way once the vocal slider would run off its range.
    let vocalPct = vocalVolume;
    let playbackPct = playbackVolume;
    if (backingBuffer && song.backing) {
      const gapDb = 1 + density * 2.5;
      const backingDb = analyzeSignal(backingBuffer).vocalLevelDb;
      const ratio = Tone.dbToGain(gapDb - (after.vocalLevelDb - backingDb));
      vocalPct = clamp(95 * ratio, 50, 200);
      playbackPct = clamp(vocalPct / ratio, 0, 150);
      report.push(
        t("studio.reportBalance", {
          db: gapDb.toFixed(1),
          arrangement: t(density >= 0.6 ? "studio.reportDense" : "studio.reportSparse"),
        }),
      );
    }

    // Presence (~3kHz): toward the target on the voice itself, plus half of whatever shortfall is
    // left against the music at the levels just chosen — the band where the backing covering the
    // voice costs the words first.
    const presenceTilt = -11 - (v.presence - v.body);
    let maskDb = 0;
    if (song.backing) {
      maskDb =
        song.backing.bands.presence +
        20 * Math.log10(Math.max(0.01, playbackPct / 100)) -
        (v.presence + 20 * Math.log10(vocalPct / 100));
    }
    const presenceDb = clamp(presenceTilt + Math.max(0, maskDb + 3) * 0.5, -3, 5);
    if (presenceDb >= 1) {
      report.push(
        t(maskDb > -3 ? "studio.reportMasking" : "studio.reportPresence", { db: presenceDb }),
      );
    } else if (presenceDb <= -1) {
      report.push(t("studio.reportPresenceCut", { db: -presenceDb }));
    }

    // Mud (~300Hz): cut only the excess over a full-but-clear low-mid.
    const mudCutDb = clamp((v.mud - v.body - 9) * 0.6, 0, 6);
    if (mudCutDb >= 1) report.push(t("studio.reportMud", { db: mudCutDb }));

    // Top end: open up a dull take, but never brighten a sibilant one — excess 5-9kHz energy
    // pulls the tilt down instead.
    const sibilanceExcess = v.sibilance - v.presence + 5;
    let tiltDb = clampF((-12 - (v.air - v.presence)) * 0.5, -4, 4);
    if (sibilanceExcess > 0) {
      tiltDb = Math.min(tiltDb, 0) - Math.min(3, sibilanceExcess * 0.5);
      report.push(t("studio.reportSibilance"));
    } else if (tiltDb >= 1) {
      report.push(t("studio.reportAir", { db: Math.round(tiltDb) }));
    } else if (tiltDb <= -1) {
      report.push(t("studio.reportDarken", { db: Math.round(-tiltDb) }));
    }
    const eqAmt = clamp(50 + (tiltDb / 8) * 50, 20, 75);

    // Compression from how unevenly the take was actually sung (loud vs soft phrases), not from
    // noise floor to peak — on a model-cleaned take that "range" is enormous and meaningless.
    const spread = song.vocal.phraseSpreadDb;
    const compAmt = clamp(((spread - 6) / 12) * 100, 15, 80);
    if (spread > 8) report.push(t("studio.reportComp", { db: Math.round(spread) }));

    // Reverb timed to the song: a tail of about two beats and a 1/64-note pre-delay, so the space
    // breathes with the tempo instead of smearing across it. A cleaned take is bone-dry and needs
    // a plate put back to sit inside the music — more in a sparse arrangement, less in a fast or
    // dense one. A raw take already carries its own room, so it only gets a sheen.
    const beat = song.tempoBpm ? 60 / song.tempoBpm : null;
    const tail = beat ? clampF(beat * 2, 0.8, 2.2) : isClean ? 1.4 : 1.0;
    const reverbSizeAmt = clamp(((tail - 0.6) / 1.8) * 100, 0, 100);
    const preDelaySeconds = beat ? clampF(beat / 16, 0.012, 0.04) : 0.03;
    const reverbAmt = isClean
      ? clamp(18 + (1 - density) * 14 - ((song.tempoBpm ?? 0) > 130 ? 4 : 0), 12, 32)
      : clamp(14 - (after.noiseFloorDb + 55) * 0.33, 4, 14);
    report.push(
      song.tempoBpm
        ? t("studio.reportReverbTempo", {
            bpm: Math.round(song.tempoBpm),
            tail: tail.toFixed(1),
            amount: reverbAmt,
          })
        : t(isClean ? "studio.reportReverb" : "studio.reportReverbRaw", {
            tail: tail.toFixed(1),
            amount: reverbAmt,
          }),
    );

    // Loudness: push toward a finished-record level, capped by the headroom the mix's own measured
    // peak actually leaves at the levels chosen above (minus slack for the EQ, presence boost and
    // reverb send ahead of the limiter) — the limiter is a fast compressor, not a true brickwall,
    // so it's only ever asked to trim a small, catchable amount. See peakDbOf for why peak, not RMS.
    const peakDb = peakDbOfMix(
      buffer,
      stems ? vocalPct / 100 : 1,
      backingBuffer,
      playbackPct / 100,
    );
    const availableHeadroomDb = -1 - peakDb - 3 - Math.max(0, presenceDb) * 0.5;
    const gainBoostDb = clamp(Math.min(-12 - after.vocalLevelDb, availableHeadroomDb), 0, 6);
    if (gainBoostDb >= 1) report.push(t("studio.reportLoudness", { db: gainBoostDb }));

    setA(Math.round(pitchStrength * 100));
    setN(lowCutHz - 50);
    setMudCut(mudCutDb);
    setPresence(presenceDb);
    setR(reverbAmt);
    setReverbSize(reverbSizeAmt);
    setPreDelay(Math.round(preDelaySeconds * 1000) / 1000);
    setE(eqAmt);
    setC(compAmt);
    setGainDb(gainBoostDb);
    setVocalVolume(vocalPct);
    setPlaybackVolume(playbackPct);
    setMasterReport(report);
    setMasterStage("done");
    if (announce) toast.success(t(isClean ? "studio.cleanupDoneToast" : "studio.masterDoneToast"));
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
    awaitingMaster || cleaningNow || masterStage === "analyzing" || masterStage === "mastering";
  type StepState = "pending" | "active" | "done";
  const replicateStatus =
    cleanupStatus.data?.status === "processing" && "replicateStatus" in cleanupStatus.data
      ? cleanupStatus.data.replicateStatus
      : null;
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
    {
      label: t("studio.stageAnalyze"),
      state:
        masterStage === "analyzing" ? "active" : masterStage === "mastering" ? "done" : "pending",
      progress: masterStage === "analyzing" ? analysisProgress : undefined,
    },
    { label: t("studio.stageMaster"), state: masterStage === "mastering" ? "active" : "pending" },
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
                      v={vocalVolume}
                      onChange={setVocalVolume}
                      min={50}
                      max={200}
                    />
                  )}
                  {stems && sources?.backingUrl && (
                    <Slider
                      label={t("record.playbackVolume")}
                      v={playbackVolume}
                      onChange={setPlaybackVolume}
                      min={0}
                      max={150}
                    />
                  )}
                  <Slider
                    label={t("record.autotune")}
                    v={autotune}
                    onChange={handleAutotuneChange}
                  />
                  <Slider label={t("record.noise")} v={noise} onChange={setN} />
                  <Slider
                    label={t("record.mudCut")}
                    v={mudCut}
                    onChange={setMudCut}
                    max={6}
                    suffix=" dB"
                  />
                  <Slider
                    label={t("record.presence")}
                    v={presence}
                    onChange={setPresence}
                    min={-6}
                    max={6}
                    suffix=" dB"
                  />
                  <Slider label={t("record.reverb")} v={reverbAmt} onChange={setR} />
                  <Slider label={t("record.reverbSize")} v={reverbSize} onChange={setReverbSize} />
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
