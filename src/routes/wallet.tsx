import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Coins, ArrowUpRight, ArrowDownRight, Plus } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getWallet, listGiftCatalog, buyCoins, withdraw, COIN_PACKAGES } from "@/functions/wallet";
import { translateServerError } from "@/lib/i18n";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
});

type WalletHistoryRow = Awaited<ReturnType<typeof getWallet>>["history"][number];

function describeTransaction(h: WalletHistoryRow, t: ReturnType<typeof useTranslation>["t"]) {
  switch (h.kind) {
    case "topup":
      return t("wallet.txnTopup", { n: h.coins });
    case "withdraw":
      return t("wallet.txnWithdraw");
    case "gift_sent":
      return t("wallet.txnGiftSent", { gift: t(`wallet.gifts.${h.description}`) });
    case "gift_received":
      return t("wallet.txnGiftReceived", { gift: t(`wallet.gifts.${h.description}`) });
    default:
      return h.description;
  }
}

function WalletPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [buyOpen, setBuyOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const { data: wallet } = useQuery({ queryKey: ["wallet"], queryFn: () => getWallet() });
  const { data: gifts } = useQuery({ queryKey: ["giftCatalog"], queryFn: () => listGiftCatalog() });

  const invalidateWallet = () => {
    queryClient.invalidateQueries({ queryKey: ["wallet"] });
    queryClient.invalidateQueries({ queryKey: ["currentUser"] });
  };

  const buyMutation = useMutation({
    mutationFn: (packageId: string) => buyCoins({ data: { packageId } }),
    onSuccess: () => {
      invalidateWallet();
      setBuyOpen(false);
      toast.success(t("wallet.coinsAdded"));
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  const withdrawMutation = useMutation({
    mutationFn: () => withdraw({ data: { amount: Number(withdrawAmount) } }),
    onSuccess: () => {
      invalidateWallet();
      setWithdrawOpen(false);
      setWithdrawAmount("");
      toast.success(t("wallet.withdrawalRecorded"));
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <h1 className="font-display text-2xl font-bold">{t("wallet.title")}</h1>

        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className="mt-4 overflow-hidden rounded-3xl bg-brand-coral p-5 text-white shadow-pop-coral"
        >
          <p className="text-xs uppercase tracking-widest opacity-90">{t("common.balance")}</p>
          <div className="mt-2 flex items-end gap-2">
            <Coins className="h-7 w-7" />
            <span className="font-display text-4xl font-bold">
              {(wallet?.balance ?? 0).toLocaleString()}
            </span>
            <span className="mb-1 text-sm opacity-90">{t("wallet.coins")}</span>
          </div>
          <p className="mt-1 text-sm opacity-90">{t("wallet.virtualCurrency")}</p>
          <div className="mt-4 flex gap-2">
            <motion.button
              whileTap={{ scale: 0.95 }}
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 420, damping: 24 }}
              onClick={() => setWithdrawOpen(true)}
              className="flex-1 rounded-full bg-white/20 backdrop-blur px-3 py-2 text-xs font-bold"
            >
              {t("common.withdraw")}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 420, damping: 24 }}
              onClick={() => setBuyOpen(true)}
              className="flex-1 rounded-full bg-white text-primary px-3 py-2 text-xs font-bold"
            >
              {t("common.buy")}
            </motion.button>
          </div>
        </motion.div>

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("wallet.giftsHeading")}
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {gifts?.map((g, i) => (
            <div
              key={g.id}
              className={`flex flex-col items-center gap-1 rounded-2xl border border-border bg-card p-3 shadow-pop hover-lift animate-fade-up stagger-${(i % 6) + 1}`}
            >
              <span className="text-3xl">{g.emoji}</span>
              <span className="text-[11px] font-semibold capitalize">
                {t(`wallet.gifts.${g.key}`)}
              </span>
              <span className="text-[11px] text-accent font-mono">{g.coins}</span>
            </div>
          ))}
        </div>

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("wallet.history")}
        </h2>
        <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card shadow-pop">
          {wallet?.history.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">{t("wallet.noTransactions")}</li>
          )}
          {wallet?.history.map((h) => (
            <li key={h.id} className="flex items-center gap-3 p-3">
              <div
                className={`grid h-9 w-9 place-items-center rounded-full ${h.coins >= 0 ? "bg-accent/20 text-accent" : "bg-primary/20 text-primary"}`}
              >
                {h.coins >= 0 ? (
                  <ArrowDownRight className="h-4 w-4" />
                ) : (
                  <ArrowUpRight className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm">{describeTransaction(h, t)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(h.createdAt), { addSuffix: true })}
                </p>
              </div>
              <span
                className={`font-mono text-sm ${h.coins >= 0 ? "text-accent" : "text-primary"}`}
              >
                {h.coins >= 0 ? "+" : ""}
                {h.coins}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common.buy")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {COIN_PACKAGES.map((pkg) => (
              <motion.button
                key={pkg.id}
                whileTap={{ scale: 0.97 }}
                whileHover={{ y: -2 }}
                transition={{ type: "spring", stiffness: 420, damping: 26 }}
                disabled={buyMutation.isPending}
                onClick={() => buyMutation.mutate(pkg.id)}
                className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-sm font-semibold shadow-pop hover:border-primary/50"
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4 text-accent" /> {pkg.coins.toLocaleString()}{" "}
                  {t("wallet.coins")}
                </span>
                <span className="text-muted-foreground">{t("wallet.addToBalance")}</span>
              </motion.button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common.withdraw")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              withdrawMutation.mutate();
            }}
          >
            <input
              type="number"
              min={1}
              max={wallet?.balance ?? 0}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder={t("wallet.upTo", { n: wallet?.balance ?? 0 })}
              className="w-full rounded-full border border-border bg-input px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
            <motion.button
              type="submit"
              whileTap={{ scale: 0.96 }}
              whileHover={{ scale: 1.01 }}
              transition={{ type: "spring", stiffness: 420, damping: 24 }}
              disabled={withdrawMutation.isPending}
              className="w-full rounded-full bg-brand-coral py-2.5 text-sm font-bold text-white shadow-pop-coral disabled:opacity-60"
            >
              {t("common.withdraw")}
            </motion.button>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
