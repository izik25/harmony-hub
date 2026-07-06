import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Search, Send, Filter, Building2, BadgeCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";

export const Route = createFileRoute("/label-hub")({
  component: LabelPage,
});

const artists = [
  { name: "Nova Ray", voice: "Alto · Pop", country: "IL", verified: true },
  { name: "Kai Aster", voice: "Baritone · R&B", country: "US", verified: false },
  { name: "Lila Moon", voice: "Soprano · Alt", country: "UK", verified: true },
  { name: "Atlas Vex", voice: "Tenor · Rock", country: "CA", verified: false },
];
const auditions = [
  { title: "Signing 2 pop artists — advance + royalties", label: "NightGlow Records" },
  { title: "Looking for female topline writer", label: "Sunset Publishing" },
  { title: "DJ resident needed for global tour", label: "PulseWave" },
];

function LabelPage() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-accent" />
          <h1 className="font-display text-2xl font-bold">{t("label.title")}</h1>
        </div>

        <label className="mt-4 flex items-center gap-2 rounded-full bg-muted/60 px-4 py-3 ring-1 ring-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input placeholder={t("label.find")} className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          <Filter className="h-4 w-4 text-muted-foreground" />
        </label>
        <p className="mt-2 text-[11px] text-muted-foreground">{t("label.filter")}</p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Talent</h2>
        <ul className="mt-2 space-y-2">
          {artists.map((a) => (
            <li key={a.name} className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 p-3">
              <img src={`https://api.dicebear.com/9.x/glass/svg?seed=${a.name}`} className="h-11 w-11 rounded-full" />
              <div className="flex-1">
                <p className="flex items-center gap-1 text-sm font-semibold">
                  {a.name} {a.verified && <BadgeCheck className="h-4 w-4 text-accent" />}
                </p>
                <p className="text-[11px] text-muted-foreground">{a.voice} · {a.country}</p>
              </div>
              <button className="flex items-center gap-1 rounded-full gradient-neon px-3 py-1.5 text-xs font-bold text-white">
                <Send className="h-3.5 w-3.5" /> {t("label.contact")}
              </button>
            </li>
          ))}
        </ul>

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Auditions</h2>
        <ul className="mt-2 space-y-2">
          {auditions.map((a, i) => (
            <li key={i} className="rounded-2xl border border-border bg-card/60 p-3">
              <p className="text-sm font-semibold">{a.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{a.label}</p>
              <div className="mt-2 flex gap-2">
                <button className="rounded-full border border-primary/50 px-3 py-1 text-xs font-semibold text-primary">Apply</button>
                <button className="rounded-full border border-border px-3 py-1 text-xs">Save</button>
              </div>
            </li>
          ))}
        </ul>

        <button className="mt-6 w-full rounded-full gradient-neon py-2.5 text-sm font-bold text-white glow-pink">
          {t("label.audition")}
        </button>
      </div>
    </AppShell>
  );
}
