import { createFileRoute } from "@tanstack/react-router";
import { Search, TrendingUp, Flame } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { feedPosts, trendingTags, genres, formatCount } from "@/lib/mock-data";

export const Route = createFileRoute("/explore")({
  component: ExplorePage,
});

const tabs = ["artists", "songs", "djs", "producers", "genres"] as const;

function ExplorePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof tabs)[number]>("artists");

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3">
        <label className="flex items-center gap-2 rounded-full bg-muted/60 px-4 py-3 ring-1 ring-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            placeholder={t("explore.search")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>

        <div className="mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar">
          {tabs.map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                tab === k
                  ? "gradient-neon text-white glow-pink"
                  : "border border-border bg-card/60 text-muted-foreground"
              }`}
            >
              {t(`explore.${k}`)}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Flame className="h-3.5 w-3.5 text-primary" /> {t("common.trending")}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {trendingTags.map((tag) => (
            <span key={tag} className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-foreground/80">
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5 text-accent" /> {t("common.top")}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {feedPosts.map((p) => (
            <article key={p.id} className="group relative aspect-[3/4] overflow-hidden rounded-2xl">
              <PostCoverBg hue={p.hue} seed={p.id} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3">
                <p className="line-clamp-1 text-sm font-semibold text-white">{p.title}</p>
                <p className="text-[11px] text-white/70">{p.user.name} · {formatCount(p.likes)} ❤</p>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-6 mb-8">
          <h3 className="mb-2 font-display text-lg font-bold">{t("explore.genres")}</h3>
          <div className="grid grid-cols-2 gap-2">
            {genres.map((g, i) => (
              <div
                key={g}
                className="rounded-xl p-3 text-sm font-semibold text-white"
                style={{ background: `linear-gradient(135deg, hsl(${(i * 40) % 360} 85% 55%), hsl(${(i * 40 + 60) % 360} 90% 45%))` }}
              >
                {g}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
