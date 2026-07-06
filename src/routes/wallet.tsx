import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Coins, ArrowUpRight, ArrowDownRight, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { gifts } from "@/lib/mock-data";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
});

const history = [
  { id: 1, kind: "in", label: "Diamond from @lilamoon", amt: "+500", when: "2h" },
  { id: 2, kind: "in", label: "Rose from @kaiaster", amt: "+10", when: "5h" },
  { id: 3, kind: "out", label: "Sent Golden Mic to @djnyx", amt: "-50", when: "1d" },
  { id: 4, kind: "in", label: "Crown from @atlasvex", amt: "+1200", when: "2d" },
  { id: 5, kind: "out", label: "Withdraw to bank", amt: "-2000", when: "5d" },
];

function WalletPage() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <h1 className="font-display text-2xl font-bold">{t("wallet.title")}</h1>

        <div className="mt-4 overflow-hidden rounded-3xl gradient-neon p-5 text-white glow-pink">
          <p className="text-xs uppercase tracking-widest opacity-90">{t("common.balance")}</p>
          <div className="mt-2 flex items-end gap-2">
            <Coins className="h-7 w-7" />
            <span className="font-display text-4xl font-bold">18,420</span>
            <span className="mb-1 text-sm opacity-90">{t("wallet.coins")}</span>
          </div>
          <p className="mt-1 text-sm opacity-90">≈ $184.20 · {t("wallet.earnings")}</p>
          <div className="mt-4 flex gap-2">
            <button className="flex-1 rounded-full bg-white/20 backdrop-blur px-3 py-2 text-xs font-bold">
              {t("common.withdraw")}
            </button>
            <button className="flex-1 rounded-full bg-white text-primary px-3 py-2 text-xs font-bold">
              {t("common.buy")}
            </button>
          </div>
        </div>

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Gifts</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {gifts.map((g) => (
            <button key={g.id} className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card/60 p-3">
              <span className="text-3xl">{g.emoji}</span>
              <span className="text-[11px] font-semibold capitalize">{t(`wallet.gifts.${g.key}`)}</span>
              <span className="text-[11px] text-accent font-mono">{g.coins}</span>
            </button>
          ))}
        </div>

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t("wallet.history")}</h2>
        <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card/40">
          {history.map((h) => (
            <li key={h.id} className="flex items-center gap-3 p-3">
              <div className={`grid h-9 w-9 place-items-center rounded-full ${h.kind === "in" ? "bg-accent/20 text-accent" : "bg-primary/20 text-primary"}`}>
                {h.kind === "in" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              </div>
              <div className="flex-1">
                <p className="text-sm">{h.label}</p>
                <p className="text-[11px] text-muted-foreground">{h.when}</p>
              </div>
              <span className={`font-mono text-sm ${h.kind === "in" ? "text-accent" : "text-primary"}`}>{h.amt}</span>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
