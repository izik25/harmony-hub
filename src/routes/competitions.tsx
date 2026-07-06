import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Trophy, Users, Award } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { competitions } from "@/lib/mock-data";

export const Route = createFileRoute("/competitions")({
  component: CompetitionsPage,
});

function CompetitionsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"active" | "upcoming" | "finished">("active");
  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">{t("comp.title")}</h1>
          <Trophy className="h-6 w-6 text-primary" />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {(["active", "upcoming", "finished"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-full px-3 py-2 text-xs font-semibold ${
                tab === k ? "gradient-neon text-white glow-pink" : "border border-border bg-card/60 text-muted-foreground"
              }`}
            >
              {t(`comp.${k}`)}
            </button>
          ))}
        </div>

        {/* featured */}
        <article className="relative mt-5 h-56 overflow-hidden rounded-3xl">
          <PostCoverBg hue={330} seed="feat" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <span className="rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
              {t("comp.final")}
            </span>
            <h2 className="mt-2 font-display text-2xl font-bold text-white">Global Voice 2026</h2>
            <div className="mt-1 flex items-center gap-3 text-xs text-white/80">
              <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> 8 finalists</span>
              <span className="flex items-center gap-1"><Award className="h-3.5 w-3.5 text-accent" /> $50,000</span>
            </div>
            <button className="mt-3 rounded-full gradient-neon px-4 py-2 text-xs font-bold text-white glow-pink">
              {t("comp.join")}
            </button>
          </div>
        </article>

        <div className="mt-6 space-y-3">
          {competitions.map((c) => (
            <article key={c.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 p-3">
              <div className="relative h-16 w-16 overflow-hidden rounded-xl">
                <PostCoverBg hue={(c.id.charCodeAt(1) * 45) % 360} seed={c.id} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">{c.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {t(`comp.${c.stage}`)} · {c.participants} · {c.prize}
                </p>
              </div>
              <button className="rounded-full border border-primary/60 px-3 py-1.5 text-xs font-semibold text-primary">
                {t("common.vote")}
              </button>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
