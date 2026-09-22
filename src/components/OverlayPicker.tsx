import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Ban, PartyPopper, Glasses, Drama, Cat, Rabbit, Mic2, Crown, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FilterKind } from "@/lib/face-filters";

// "none" plus every FilterKind face-filters.ts knows how to paint — generic props (hat, mask,
// glasses, ears) alongside a couple of singer-styled ones (mic, crown) per the product ask for
// "not just a background — actual filters, including things like a hat, a mask, or even a singer
// look." Unlike FilterShop (buy-a-gift, plays once for a few seconds — see face-filters.ts's own
// doc comment on why those are transient), picking one here pins it face-tracked for the rest of
// the take and bakes it into the recording, the same permanence a background pick already has.
const OVERLAY_OPTIONS: { id: FilterKind | "none"; labelKey: string; Icon: LucideIcon }[] = [
  { id: "none", labelKey: "record.overlay.none", Icon: Ban },
  { id: "partyhat", labelKey: "record.overlay.partyhat", Icon: PartyPopper },
  { id: "crown", labelKey: "record.overlay.crown", Icon: Crown },
  { id: "mic", labelKey: "record.overlay.mic", Icon: Mic2 },
  { id: "sunglasses", labelKey: "record.overlay.sunglasses", Icon: Glasses },
  { id: "mask", labelKey: "record.overlay.mask", Icon: Drama },
  { id: "catears", labelKey: "record.overlay.catears", Icon: Cat },
  { id: "bunnyears", labelKey: "record.overlay.bunnyears", Icon: Rabbit },
];

/**
 * Horizontal tray of persistent, face-tracked overlay props — the "stays on for the whole take"
 * counterpart to FilterShop's few-seconds gifts. Tap one to pin it (face-tracked live by
 * camera-effects.ts) over the selfie camera until you pick "None" or another one.
 */
export function OverlayPicker({
  value,
  onChange,
  disabled,
}: {
  value: FilterKind | null;
  onChange: (kind: FilterKind | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-0.5 pt-1">
      {OVERLAY_OPTIONS.map(({ id, labelKey, Icon }) => {
        const selected = (value ?? "none") === id;
        return (
          <motion.button
            key={id}
            type="button"
            onClick={() => onChange(id === "none" ? null : id)}
            disabled={disabled}
            whileTap={disabled ? undefined : { scale: 0.93 }}
            aria-pressed={selected}
            aria-label={t(labelKey)}
            className={`relative flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border transition-colors disabled:opacity-50 ${
              selected
                ? "border-primary bg-primary/10 shadow-pop-coral"
                : "border-border bg-muted/50"
            }`}
          >
            <Icon className="h-6 w-6 text-foreground/80" />
            <span className="line-clamp-1 px-1 text-center text-[10px] font-semibold text-muted-foreground">
              {t(labelKey)}
            </span>
            {selected && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="absolute end-1 top-1 grid h-4.5 w-4.5 place-items-center rounded-full bg-primary text-primary-foreground shadow"
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </motion.span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
