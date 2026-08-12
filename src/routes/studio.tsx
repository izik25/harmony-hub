import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Sliders, Wand2, Waves, Download, Send, Play, Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import * as Tone from "tone";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { getDraft, updateDraftAudio } from "@/functions/posts";
import { uploadMedia } from "@/functions/uploads";
import { audioBufferToWavBlob } from "@/lib/wav-encoder";
import { generateImpulseResponse } from "@/lib/impulse-response";
import { translateServerError } from "@/lib/i18n";

interface StudioSearch {
  draftId?: string;
  autotune?: number;
  pitch?: number;
  speed?: number;
  reverb?: number;
}

export const Route = createFileRoute("/studio")({
  validateSearch: (search: Record<string, unknown>): StudioSearch => ({
    draftId: typeof search.draftId === "string" ? search.draftId : undefined,
    autotune: typeof search.autotune === "number" ? search.autotune : undefined,
    pitch: typeof search.pitch === "number" ? search.pitch : undefined,
    speed: typeof search.speed === "number" ? search.speed : undefined,
    reverb: typeof search.reverb === "number" ? search.reverb : undefined,
  }),
  component: StudioPage,
});

type VocalChain = {
  player: Tone.Player;
  pitchShift: Tone.PitchShift;
  filter: Tone.Filter;
  eq3: Tone.EQ3;
  compressor: Tone.Compressor;
  reverbConvolver: Tone.Convolver;
  reverbDry: Tone.Gain;
  reverbWet: Tone.Gain;
};

type Params = {
  autotune: number;
  pitch: number;
  speed: number;
  noise: number;
  reverb: number;
  eq: number;
  compression: number;
};

// A hand-generated decaying-noise impulse response (see src/lib/impulse-response.ts) keeps the
// convolution reverb fully synchronous — no async IR generation, which is unsafe to nest inside
// Tone.Offline (used for export/publish) since it swaps the global audio context internally.
function buildChain(onEnded?: () => void): VocalChain {
  const pitchShift = new Tone.PitchShift();
  const filter = new Tone.Filter({ type: "highpass" });
  const eq3 = new Tone.EQ3();
  const compressor = new Tone.Compressor();

  const rawContext = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const impulse = generateImpulseResponse(rawContext);
  const reverbConvolver = new Tone.Convolver(impulse);
  const reverbDry = new Tone.Gain(1);
  const reverbWet = new Tone.Gain(0);
  const reverbOut = new Tone.Gain(1).toDestination();

  compressor.fan(reverbDry, reverbConvolver);
  reverbConvolver.connect(reverbWet);
  reverbDry.connect(reverbOut);
  reverbWet.connect(reverbOut);

  const player = onEnded ? new Tone.Player({ onstop: onEnded }) : new Tone.Player();
  player.chain(pitchShift, filter, eq3, compressor);

  return { player, pitchShift, filter, eq3, compressor, reverbConvolver, reverbDry, reverbWet };
}

function applyParams(chain: VocalChain, p: Params) {
  chain.pitchShift.pitch = p.pitch;
  chain.pitchShift.wet.value = p.autotune / 100;
  chain.player.playbackRate = p.speed / 100;
  chain.filter.frequency.value = 80 + (p.noise / 100) * 300;
  const eqDb = ((p.eq - 50) / 50) * 12;
  chain.eq3.low.value = eqDb;
  chain.eq3.high.value = eqDb;
  chain.compressor.threshold.value = -6 - (p.compression / 100) * 30;
  chain.compressor.ratio.value = 1 + (p.compression / 100) * 15;
  const wetAmt = (p.reverb / 100) * 0.7;
  chain.reverbWet.gain.value = wetAmt;
  chain.reverbDry.gain.value = 1 - wetAmt * 0.5;
}

function disposeChain(chain: VocalChain) {
  chain.player.dispose();
  chain.pitchShift.dispose();
  chain.filter.dispose();
  chain.eq3.dispose();
  chain.compressor.dispose();
  chain.reverbConvolver.dispose();
  chain.reverbDry.dispose();
  chain.reverbWet.dispose();
}

function StudioPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const draftId = search.draftId;
  const pitchRef = useRef(search.pitch ?? 0);

  const [autotune, setA] = useState(search.autotune ?? 40);
  const [reverbAmt, setR] = useState(search.reverb ?? 30);
  const [eq, setE] = useState(50);
  const [comp, setC] = useState(30);
  const [noise, setN] = useState(0);
  const [speed, setSpeed] = useState(search.speed ?? 100);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  const chainRef = useRef<VocalChain | null>(null);

  const { data: draft } = useQuery({
    queryKey: ["draft", draftId],
    queryFn: () => getDraft({ data: { id: draftId! } }),
    enabled: !!draftId,
  });

  useEffect(() => {
    if (!draft?.audioUrl) return;
    let disposed = false;
    const chain = buildChain(() => setPlaying(false));
    chainRef.current = chain;
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
        if (!disposed) setReady(true);
      })
      .catch((err) => {
        if (!disposed) toast.error(t("studio.couldNotLoad"));
        console.error(err);
      });
    return () => {
      disposed = true;
      disposeChain(chain);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.audioUrl]);

  useEffect(() => {
    if (!chainRef.current) return;
    applyParams(chainRef.current, {
      autotune,
      pitch: pitchRef.current,
      speed,
      noise,
      reverb: reverbAmt,
      eq,
      compression: comp,
    });
  }, [autotune, noise, reverbAmt, eq, comp, speed]);

  const togglePlay = async () => {
    const chain = chainRef.current;
    if (!chain || !ready) return;
    await Tone.start();
    if (playing) {
      chain.player.stop();
      setPlaying(false);
    } else {
      chain.player.start();
      setPlaying(true);
    }
  };

  const renderProcessed = async (): Promise<Blob> => {
    const chain = chainRef.current;
    if (!chain || !ready || !draft?.audioUrl) throw new Error(t("studio.loadTrackFirst"));
    const sourceDuration = chain.player.buffer.duration;
    const duration = sourceDuration / (speed / 100) + 0.3;
    const params: Params = {
      autotune,
      pitch: pitchRef.current,
      speed,
      noise,
      reverb: reverbAmt,
      eq,
      compression: comp,
    };
    const audioUrl = draft.audioUrl;

    const rendered = await Tone.Offline(async () => {
      const offlineChain = buildChain();
      // Re-decode fresh in the offline context rather than reusing the live AudioContext's
      // buffer — Chromium can silently stall OfflineAudioContext rendering when a source node
      // references an AudioBuffer decoded by a different context.
      await offlineChain.player.load(audioUrl);
      applyParams(offlineChain, params);
      offlineChain.player.start(0);
    }, duration);

    const audioBuffer = rendered.get();
    if (!audioBuffer) throw new Error(t("studio.exportFailed"));
    return audioBufferToWavBlob(audioBuffer);
  };

  const exportMutation = useMutation({
    mutationFn: renderProcessed,
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sona-studio-export.wav";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("studio.exportedToast"));
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error(t("studio.nothingToPublish"));
      const blob = await renderProcessed();
      const formData = new FormData();
      formData.append("file", blob, `studio-${Date.now()}.wav`);
      const { url } = await uploadMedia({ data: formData });
      await updateDraftAudio({ data: { id: draftId, audioUrl: url } });
      return draftId;
    },
    onSuccess: (id) => navigate({ to: "/upload", search: { draftId: id } }),
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const applyEnhance = () => {
    setN(70);
    setC(60);
    setE(60);
    toast.success(t("studio.enhanceApplied"));
  };
  const applyMaster = () => {
    setR(20);
    setC(70);
    setE(55);
    toast.success(t("studio.masterApplied"));
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
          <div className="mt-6 rounded-3xl border border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
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
            <div className="mt-4 rounded-3xl border border-border bg-card/50 p-4">
              <div className="relative h-24 overflow-hidden rounded-xl bg-background/70">
                <div className="absolute inset-0 flex items-center justify-around px-2">
                  {Array.from({ length: 60 }).map((_, i) => (
                    <span
                      key={i}
                      className="w-0.5 rounded-full"
                      style={{
                        height: `${12 + Math.abs(Math.sin(i / 3)) * 60}%`,
                        background: `hsl(${(i * 6) % 360} 90% 60%)`,
                      }}
                    />
                  ))}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    onClick={togglePlay}
                    disabled={!ready}
                    className="grid h-14 w-14 place-items-center rounded-full gradient-neon glow-pink disabled:opacity-50"
                  >
                    {playing ? (
                      <Pause className="h-6 w-6 text-white" />
                    ) : (
                      <Play className="h-6 w-6 text-white" />
                    )}
                  </button>
                </div>
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground font-mono">
                <span>{ready ? t("studio.loaded") : t("studio.loading")}</span>
                <span>
                  {chainRef.current?.player.buffer.duration
                    ? `${chainRef.current.player.buffer.duration.toFixed(1)}s`
                    : ""}
                </span>
              </div>
            </div>

            <section className="mt-5 rounded-3xl border border-border bg-card/50 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Sliders className="h-4 w-4 text-accent" /> {t("studio.vocalChain")}
              </h2>
              <Slider label={t("record.autotune")} v={autotune} onChange={setA} />
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
            </section>

            <section className="mt-4 rounded-3xl border border-accent/40 bg-accent/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-accent">
                <Waves className="h-4 w-4" /> {t("studio.masteringPreset")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("studio.masteringDesc")}</p>
              <button
                onClick={applyMaster}
                className="mt-3 w-full rounded-full gradient-neon py-2.5 text-sm font-bold text-white glow-pink"
              >
                {t("record.master")}
              </button>
            </section>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <button
                onClick={applyEnhance}
                className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card/60 p-3 text-[11px] font-semibold"
              >
                <Wand2 className="h-4 w-4" /> {t("record.enhance")}
              </button>
              <button
                onClick={() => exportMutation.mutate()}
                disabled={!ready || exportMutation.isPending}
                className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card/60 p-3 text-[11px] font-semibold disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> {t("record.export")}
              </button>
              <button
                onClick={() => publishMutation.mutate()}
                disabled={!ready || publishMutation.isPending}
                className="flex flex-col items-center gap-1 rounded-2xl gradient-neon p-3 text-[11px] font-bold text-white glow-pink disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> {t("common.continueToPublish")}
              </button>
            </div>
          </>
        )}
      </div>
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
        className="w-full accent-primary"
      />
    </div>
  );
}
