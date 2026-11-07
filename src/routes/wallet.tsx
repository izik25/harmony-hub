import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { GiftGlyph } from "@/components/GiftGlyph";
import { Coins, ArrowUpRight, ArrowDownRight, Plus, Crown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFormatNumber, useTimeAgo } from "@/hooks/use-locale-format";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { BecomeProModal } from "@/components/BecomeProModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getWallet, listGiftCatalog, buyCoins, withdraw, COIN_PACKAGES } from "@/functions/wallet";
import { translateServerError } from "@/lib/i18n";
import { useCurrentUser } from "@/hooks/use-current-user";

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
    case "pro_purchase":
      return t("wallet.txnProPurchase");
    case "export_purchase":
      return t("wallet.txnExportPurchase");
    default:
      return h.description;
  }
}

function WalletPage() {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const formatNumber = useFormatNumber();
  const queryClient = useQueryClient();
  const [buyOpen, setBuyOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [proOpen, setProOpen] = useState(false);

  const { data: currentUser } = useCurrentUser();
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
      <div className="px-4 pb-8 pt-6">
        <h1 className="page-title">{t("wallet.title")}</h1>

        {/* Balance reads like a meter on a dark panel; colour is saved for the actions. */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mt-5 overflow-hidden rounded-[22px] border border-border bg-card shadow-pop"
        >
          <div className="relative px-5 pb-5 pt-5">
            <p className="section-label">{t("common.balance")}</p>
            <div className="mt-2 flex items-center gap-3">
              <Coins className="h-7 w-7 shrink-0 text-brand-gold" />
              <span className="font-numeric text-[2.75rem] font-bold leading-none text-brand-gold">
                {formatNumber(wallet?.balance ?? 0)}
              </span>
              <span className="self-end pb-1 text-sm text-muted-foreground">
                {t("wallet.coins")}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t("wallet.virtualCurrency")}</p>
            <div className="mt-5 flex gap-2">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setBuyOpen(true)}
                className="flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-brand-coral text-sm font-bold text-white shadow-pop-coral transition-[filter] hover:brightness-110"
              >
                <Plus className="h-4 w-4" />
                {t("common.buy")}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setWithdrawOpen(true)}
                className="flex h-12 flex-1 items-center justify-center rounded-xl border border-[var(--hairline-strong)] text-sm font-semibold transition-colors hover:bg-muted/50"
              >
                {t("common.withdraw")}
              </motion.button>
            </div>
          </div>
          {!currentUser?.isPro && (
            <button
              onClick={() => setProOpen(true)}
              className="flex w-full items-center gap-3 border-t border-border px-5 py-3.5 text-start transition-colors hover:bg-muted/50"
            >
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-gold/15 text-brand-gold">
                <Crown className="h-4 w-4" />
              </span>
              <span className="flex-1 text-sm font-semibold">{t("pro.title")}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
            </button>
          )}
        </motion.section>

        <h2 className="section-label mt-8">{t("wallet.giftsHeading")}</h2>
        {/* One panel, hairline grid: a price list, not a wall of cards. */}
        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-[18px] border border-border bg-border lg:grid-cols-5">
          {gifts?.map((g) => (
            <div key={g.id} className="flex flex-col items-center gap-1 bg-card px-2 py-4">
              <GiftGlyph giftKey={g.key} emoji={g.emoji} />
              <span className="mt-1 text-xs font-medium capitalize">
                {t(`wallet.gifts.${g.key}`)}
              </span>
              <span className="font-numeric text-xs font-bold text-brand-gold">{g.coins}</span>
            </div>
          ))}
          {/* Pad the last row with empty cells so the hairline grid closes cleanly (3 columns on
              phones, 5 on desktop). */}
          {gifts &&
            Array.from({ length: 4 }).map((_, i) => {
              const phone = (3 - (gifts.length % 3)) % 3;
              const desk = (5 - (gifts.length % 5)) % 5;
              return (
                <div
                  key={`pad-${i}`}
                  aria-hidden
                  className={`bg-card ${i < phone ? "block" : "hidden"} ${i < desk ? "lg:block" : "lg:hidden"}`}
                />
              );
            })}
        </div>

        <h2 className="section-label mt-8">{t("wallet.history")}</h2>
        <ul className="list-group mt-3">
          {wallet?.history.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">{t("wallet.noTransactions")}</li>
          )}
          {wallet?.history.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-4 py-3">
              <div
                className={`grid h-9 w-9 place-items-center rounded-full ${h.coins >= 0 ? "bg-accent/20 text-accent" : "bg-primary/20 text-brand-coral"}`}
              >
                {h.coins >= 0 ? (
                  <ArrowDownRight className="h-4 w-4" />
                ) : (
                  <ArrowUpRight className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm">{describeTransaction(h, t)}</p>
                <p className="text-[11px] text-muted-foreground">{timeAgo(h.createdAt)}</p>
              </div>
              <span
                dir="ltr"
                className={`font-numeric text-sm font-bold ${h.coins >= 0 ? "text-brand-gold" : "text-brand-coral"}`}
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
                  <Plus className="h-4 w-4 text-accent" /> {formatNumber(pkg.coins)}{" "}
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

      <BecomeProModal open={proOpen} onOpenChange={setProOpen} />
    </AppShell>
  );
}
