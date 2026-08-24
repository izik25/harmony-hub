import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Crown, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { purchasePro, PRO_PRICE_COINS } from "@/functions/wallet";
import { translateServerError } from "@/lib/i18n";

const PERK_KEYS = ["freeExports", "proBadge"] as const;

export function BecomeProModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const purchaseMutation = useMutation({
    mutationFn: () => purchasePro(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      toast.success(t("pro.purchased"));
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(translateServerError(e.message)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-brand-gold" /> {t("pro.title")}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("pro.subtitle")}</p>

        <ul className="mt-3 space-y-2">
          {PERK_KEYS.map((key) => (
            <li key={key} className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 shrink-0 text-accent" /> {t(`pro.perks.${key}`)}
            </li>
          ))}
        </ul>

        <motion.button
          whileTap={{ scale: 0.97 }}
          whileHover={{ scale: 1.01, y: -2 }}
          transition={{ type: "spring", stiffness: 400, damping: 26 }}
          onClick={() => purchaseMutation.mutate()}
          disabled={purchaseMutation.isPending}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-brand-gold py-3 text-sm font-bold text-white shadow-pop disabled:opacity-50"
        >
          {purchaseMutation.isPending
            ? t("pro.purchasing")
            : t("pro.cta", { coins: PRO_PRICE_COINS })}
        </motion.button>
      </DialogContent>
    </Dialog>
  );
}
