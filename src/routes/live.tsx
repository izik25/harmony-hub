import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Radio, Users, Gift, UserPlus, Send } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { PostCoverBg } from "@/components/PostCoverBg";
import { liveRooms, formatCount } from "@/lib/mock-data";

export const Route = createFileRoute("/live")({
  component: LivePage,
});

function LivePage() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary animate-pulse-glow" />
            {t("live.title")}
          </h1>
          <button className="rounded-full gradient-neon px-4 py-1.5 text-xs font-bold text-white glow-pink">
            Go Live
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {liveRooms.map((r, i) => (
            <article key={r.id} className="relative aspect-[3/4] overflow-hidden rounded-2xl">
              <PostCoverBg hue={(i * 60 + 280) % 360} seed={r.id} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/40" />
              <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-white animate-pulse-glow">
                {t("common.live")}
              </span>
              <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full glass px-2 py-0.5 text-[10px] font-semibold text-white">
                <Users className="h-3 w-3" /> {formatCount(r.viewers)}
              </span>
              <div className="absolute inset-x-0 bottom-0 p-3">
                <div className="flex items-center gap-2">
                  <img src={r.avatar} className="h-8 w-8 rounded-full border-2 border-white" />
                  <div>
                    <p className="text-sm font-bold text-white">{r.host}</p>
                    <p className="text-[10px] text-white/80 capitalize">{r.type === "battle" ? t("live.battle") : r.type}</p>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* Live room preview */}
        <section className="mt-6 rounded-3xl border border-border bg-card/50 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Now playing</h2>
          <div className="mt-3 flex items-center gap-3">
            <div className="relative h-16 w-16 overflow-hidden rounded-xl">
              <PostCoverBg hue={330} seed="lp" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">Nova Ray vs. Kai Aster</p>
              <p className="text-[11px] text-muted-foreground">{t("live.battle")} · Round 2 / 3</p>
            </div>
            <div className="text-end">
              <p className="text-xs text-accent font-mono">02:14</p>
              <p className="text-[10px] text-muted-foreground">remaining</p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <ChatBubble user="Skylar" msg="Nova going crazy 🔥🔥" />
            <ChatBubble user="Mira" msg="Kai has that low range tho" />
            <ChatBubble user="DJ Nyx" msg="💎 sent a Diamond" gift />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input placeholder={t("live.chat")} className="flex-1 rounded-full bg-background/70 px-4 py-2 text-sm outline-none ring-1 ring-border" />
            <button className="grid h-10 w-10 place-items-center rounded-full glass"><Gift className="h-5 w-5 text-accent" /></button>
            <button className="grid h-10 w-10 place-items-center rounded-full glass"><UserPlus className="h-5 w-5" /></button>
            <button className="grid h-10 w-10 place-items-center rounded-full gradient-neon"><Send className="h-5 w-5 text-white" /></button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
function ChatBubble({ user, msg, gift }: { user: string; msg: string; gift?: boolean }) {
  return (
    <div className={`flex items-start gap-2 text-xs ${gift ? "text-accent" : ""}`}>
      <span className="font-semibold text-foreground/80">{user}</span>
      <span className={gift ? "font-bold" : "text-foreground/90"}>{msg}</span>
    </div>
  );
}
