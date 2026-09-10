import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

export type FilterGift = {
  id: string;
  key: string;
  emoji: string;
  coins: number;
  filterKind: string | null;
};

/**
 * Horizontal tray of filter gifts (party hat, sunglasses, ...) you can buy for yourself — tap one
 * to spend coins and trigger it live over your own camera for a few seconds (see
 * FaceFilterOverlay.tsx). The exact same catalog rows show up in the feed's "send a gift" sheet
 * (GiftSheet in routes/index.tsx) for sending one to someone else instead.
 */
export function FilterShop({
  items,
  pendingId,
  playingKind,
  onBuy,
  disabled,
}: {
  items: FilterGift[];
  pendingId: string | null;
  playingKind: string | null;
  onBuy: (item: FilterGift) => void;
  disabled?: boolean;
}) {
  return (
    <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-0.5 pt-1">
      {items.map((item) => {
        const isPending = pendingId === item.id;
        const isPlaying = !!item.filterKind && playingKind === item.filterKind;
        const inactive = disabled || isPending || !!playingKind;
        return (
          <motion.button
            key={item.id}
            type="button"
            onClick={() => onBuy(item)}
            disabled={inactive}
            whileTap={inactive ? undefined : { scale: 0.93 }}
            className={`relative flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border transition-colors disabled:opacity-50 ${
              isPlaying
                ? "border-primary bg-primary/10 shadow-pop-coral"
                : "border-border bg-muted/50"
            }`}
          >
            {isPending ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-2xl">{item.emoji}</span>
            )}
            <span className="text-[10px] font-bold text-accent">{item.coins}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
