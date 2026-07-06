import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Settings, BadgeCheck, ExternalLink, MessageSquare, Share2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { feedPosts, formatCount } from "@/lib/mock-data";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

const tabs = ["videos", "songs", "covers", "live", "competitions", "about"] as const;

function ProfilePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof tabs)[number]>("videos");
  return (
    <AppShell>
      <TopBar />
      <div className="relative">
        <div className="h-40 gradient-neon opacity-70" />
        <button className="absolute right-4 top-4 rounded-full glass p-2">
          <Settings className="h-4 w-4" />
        </button>
        <div className="-mt-12 px-4">
          <img src="https://api.dicebear.com/9.x/glass/svg?seed=me" alt="" className="h-24 w-24 rounded-full border-4 border-background" />
          <div className="mt-2 flex items-center gap-1">
            <h1 className="font-display text-xl font-bold">Nova Ray</h1>
            <BadgeCheck className="h-5 w-5 text-accent" />
          </div>
          <p className="text-sm text-muted-foreground">@novaray · {t("profile.verified")}</p>
          <p className="mt-2 max-w-md text-sm">Singer · Songwriter · Tel Aviv → LA. New EP dropping Q1.</p>

          <div className="mt-3 flex items-center gap-3 text-sm">
            <Stat n="1.2M" k={t("profile.followers")} />
            <Stat n="284" k={t("profile.following")} />
            <Stat n="14.8M" k={t("profile.likes")} />
          </div>

          <div className="mt-4 flex gap-2">
            <button className="flex-1 rounded-full gradient-neon py-2 text-sm font-bold text-white glow-pink">
              {t("common.follow")}
            </button>
            <button className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4" />
            </button>
            <button className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold">
              <Share2 className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <ExtLink label="Spotify" />
            <ExtLink label="YouTube" />
            <ExtLink label="Instagram" />
          </div>
        </div>

        {/* tabs */}
        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border px-2 no-scrollbar">
          {tabs.map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`shrink-0 border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider ${
                tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground"
              }`}
            >
              {t(`profile.${k}`)}
            </button>
          ))}
        </div>

        {tab === "about" ? (
          <div className="p-4 text-sm">
            <h3 className="font-semibold">Discography</h3>
            <ul className="mt-2 space-y-2 text-muted-foreground">
              <li>2026 · Neon Skies (EP)</li>
              <li>2025 · Midnight Rooftop (single)</li>
              <li>2024 · First Light (single)</li>
            </ul>
            <h3 className="mt-4 font-semibold">Credits</h3>
            <p className="mt-1 text-muted-foreground">Wrote / composed on 12 tracks · Produced 4 · Featured on 7</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1 p-1">
            {feedPosts.concat(feedPosts).map((p, i) => (
              <div key={i} className="relative aspect-[3/4] overflow-hidden">
                <PostCoverBg hue={(p.hue + i * 30) % 360} seed={p.id + i} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[10px] font-semibold text-white">
                  ▶ {formatCount(p.likes)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
function Stat({ n, k }: { n: string; k: string }) {
  return (
    <div className="text-center">
      <p className="font-display text-lg font-bold">{n}</p>
      <p className="text-[11px] text-muted-foreground">{k}</p>
    </div>
  );
}
function ExtLink({ label }: { label: string }) {
  return (
    <a className="flex items-center gap-1 rounded-full border border-border bg-card/60 px-3 py-1 text-xs">
      {label} <ExternalLink className="h-3 w-3" />
    </a>
  );
}
