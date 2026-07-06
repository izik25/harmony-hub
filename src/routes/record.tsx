import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Music2, Wand2, Sliders, Save, Send, Play, Square } from "lucide-react";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";

export const Route = createFileRoute("/record")({
  component: RecordPage,
});

function RecordPage() {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [autotune, setAutotune] = useState(60);
  const [pitch, setPitch] = useState(0);
  const [speed, setSpeed] = useState(100);
  const [reverb, setReverb] = useState(30);

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">{t("record.title")}</h1>
          <Link to="/upload" className="text-xs text-accent underline">Skip → Upload</Link>
        </div>

        {/* Karaoke picker */}
        <button className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-border bg-card/60 p-3 text-start">
          <div className="grid h-12 w-12 place-items-center rounded-xl gradient-neon">
            <Music2 className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{t("record.karaoke")}</p>
            <p className="text-xs text-muted-foreground">Browse 2M+ tracks — pop, hip-hop, R&B…</p>
          </div>
        </button>

        {/* Waveform */}
        <div className="mt-6 rounded-3xl border border-border bg-card/50 p-4">
          <div className="relative h-40 overflow-hidden rounded-2xl bg-background/70">
            <div className="absolute inset-0 flex items-center justify-around px-3">
              {Array.from({ length: 48 }).map((_, i) => (
                <motion.span
                  key={i}
                  animate={{ height: recording ? [8, 20 + (i % 9) * 6, 12] : 8 + (i % 5) * 4 }}
                  transition={{ duration: 0.6 + (i % 7) * 0.05, repeat: Infinity, ease: "easeInOut" }}
                  className="w-1 rounded-full"
                  style={{ background: `hsl(${300 + (i * 3) % 60} 90% 60%)` }}
                />
              ))}
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setRecording((v) => !v)}
                className={`grid h-20 w-20 place-items-center rounded-full gradient-neon glow-pink ${recording ? "animate-pulse-glow" : ""}`}
              >
                {recording ? <Square className="h-8 w-8 text-white" /> : <Mic className="h-9 w-9 text-white" />}
              </motion.button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>00:00</span>
            <span>{recording ? "● REC" : "READY"}</span>
            <span>03:20</span>
          </div>
        </div>

        {/* AI controls */}
        <section className="mt-6 rounded-3xl border border-border bg-card/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">AI Vocal</h2>
          </div>
          <Knob label={t("record.autotune")} value={autotune} onChange={setAutotune} suffix="%" />
          <Knob label={t("record.pitch")} value={pitch} onChange={setPitch} min={-12} max={12} suffix=" st" />
          <Knob label={t("record.speed")} value={speed} onChange={setSpeed} min={50} max={150} suffix="%" />
          <Knob label={t("record.reverb")} value={reverb} onChange={setReverb} suffix="%" />

          <div className="mt-3 grid grid-cols-2 gap-2">
            <ChipBtn>{t("record.noise")}</ChipBtn>
            <ChipBtn>{t("record.enhance")}</ChipBtn>
            <ChipBtn>{t("record.eq")}</ChipBtn>
            <ChipBtn>{t("record.compression")}</ChipBtn>
          </div>
          <Link to="/studio" className="mt-3 flex items-center justify-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-semibold text-accent">
            <Sliders className="h-4 w-4" /> Open AI Studio
          </Link>
        </section>

        {/* Actions */}
        <div className="mt-6 grid grid-cols-4 gap-2">
          <BigAction icon={<Play className="h-5 w-5" />} label={t("common.preview")} />
          <BigAction icon={<Save className="h-5 w-5" />} label={t("common.save")} />
          <BigAction icon={<Send className="h-5 w-5" />} label={t("common.publish")} primary />
          <BigAction icon={<Send className="h-5 w-5" />} label={t("record.sendComp")} />
        </div>
      </div>
    </AppShell>
  );
}

function Knob({ label, value, onChange, min = 0, max = 100, suffix = "" }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-foreground/90">{label}</span>
        <span className="font-mono text-accent">{value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}
function ChipBtn({ children }: { children: React.ReactNode }) {
  return (
    <button className="rounded-full border border-border bg-background/60 px-3 py-2 text-xs font-semibold text-foreground/90 hover:border-primary/50">
      {children}
    </button>
  );
}
function BigAction({ icon, label, primary }: { icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <button className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-[11px] font-semibold ${primary ? "gradient-neon border-transparent text-white glow-pink" : "border-border bg-card/60 text-foreground/90"}`}>
      {icon}
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}
