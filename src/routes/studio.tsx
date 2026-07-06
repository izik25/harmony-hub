import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Sliders, Wand2, Waves, Download, Send } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";

export const Route = createFileRoute("/studio")({
  component: StudioPage,
});

function StudioPage() {
  const { t } = useTranslation();
  const [autotune, setA] = useState(72);
  const [reverb, setR] = useState(38);
  const [eq, setE] = useState(50);
  const [comp, setC] = useState(45);
  const [noise, setN] = useState(80);

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <div className="flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-accent" />
          <h1 className="font-display text-2xl font-bold">AI Music Studio</h1>
        </div>
        <p className="text-xs text-muted-foreground">Studio-grade vocal enhancement, powered by AI.</p>

        {/* Waveform preview */}
        <div className="mt-4 rounded-3xl border border-border bg-card/50 p-4">
          <div className="relative h-24 overflow-hidden rounded-xl bg-background/70">
            <div className="absolute inset-0 flex items-center justify-around px-2">
              {Array.from({ length: 60 }).map((_, i) => (
                <span key={i} className="w-0.5 rounded-full"
                  style={{ height: `${12 + Math.abs(Math.sin(i / 3)) * 60}%`, background: `hsl(${(i * 6) % 360} 90% 60%)` }} />
              ))}
            </div>
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground font-mono">
            <span>00:00</span><span>-1.4 dB peak</span><span>03:28</span>
          </div>
        </div>

        <section className="mt-5 rounded-3xl border border-border bg-card/50 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Sliders className="h-4 w-4 text-accent" /> Vocal chain</h2>
          <Slider label={t("record.autotune")} v={autotune} onChange={setA} />
          <Slider label={t("record.noise")} v={noise} onChange={setN} />
          <Slider label={t("record.reverb")} v={reverb} onChange={setR} />
          <Slider label={t("record.eq")} v={eq} onChange={setE} />
          <Slider label={t("record.compression")} v={comp} onChange={setC} />
        </section>

        <section className="mt-4 rounded-3xl border border-accent/40 bg-accent/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-accent"><Waves className="h-4 w-4" /> AI Mastering</h2>
          <p className="mt-1 text-xs text-muted-foreground">One-tap loudness, clarity and glue. Targets -14 LUFS.</p>
          <button className="mt-3 w-full rounded-full gradient-neon py-2.5 text-sm font-bold text-white glow-pink">
            {t("record.master")}
          </button>
        </section>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <button className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card/60 p-3 text-[11px] font-semibold">
            <Wand2 className="h-4 w-4" /> {t("record.enhance")}
          </button>
          <button className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card/60 p-3 text-[11px] font-semibold">
            <Download className="h-4 w-4" /> {t("record.export")}
          </button>
          <button className="flex flex-col items-center gap-1 rounded-2xl gradient-neon p-3 text-[11px] font-bold text-white glow-pink">
            <Send className="h-4 w-4" /> {t("common.publish")}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
function Slider({ label, v, onChange }: { label: string; v: number; onChange: (n: number) => void }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span><span className="font-mono text-accent">{v}%</span>
      </div>
      <input type="range" min={0} max={100} value={v} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </div>
  );
}
