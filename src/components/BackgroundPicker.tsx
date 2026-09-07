import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Aperture, CloudFog, Lightbulb, Drama, Users, Check, type LucideIcon } from "lucide-react";
import { BACKGROUND_OPTIONS, type BackgroundId } from "@/lib/virtual-background";

// Approximates each real, canvas-rendered scene from virtual-background.ts using plain CSS
// gradients — cheap to render as a picker thumbnail without spinning up the segmentation model
// or drawing to an actual canvas just to preview a swatch. "none" and "blur" get a deliberately
// dark neutral tile (rather than a washed-out light one) so their icon reads clearly against it —
// every tile in the tray keeps the same white-icon-on-dark-or-vivid-fill contrast.
const TILE_BACKGROUND: Record<BackgroundId, string> = {
  none: "linear-gradient(165deg, #4b5563, #1c2330)",
  blur: "linear-gradient(150deg, color-mix(in oklab, var(--brand-teal) 55%, #101820) 0%, #10161c 100%)",
  studio:
    "radial-gradient(circle at 30% 18%, rgba(245,240,230,0.55), transparent 55%), linear-gradient(160deg, #2a2e37, #101217)",
  stage:
    "radial-gradient(circle at 50% 10%, rgba(255,243,214,0.6), transparent 45%), linear-gradient(180deg, #0c0d12 0%, #15161d 65%, #2b1d14 100%)",
  arena:
    "radial-gradient(circle at 50% 4%, rgba(255,255,255,0.35), transparent 40%), linear-gradient(200deg, color-mix(in oklab, var(--brand-teal) 55%, transparent) 0%, transparent 45%), linear-gradient(150deg, color-mix(in oklab, var(--brand-coral) 55%, transparent) 0%, transparent 45%), linear-gradient(180deg, #08080d, #141018)",
  green: "linear-gradient(165deg, #22d16f, #0e9c4f)",
  blue: "linear-gradient(165deg, #3b8aef, #0f56c4)",
  coral:
    "linear-gradient(165deg, color-mix(in oklab, var(--brand-coral) 85%, white), var(--brand-coral))",
  indigo:
    "linear-gradient(165deg, color-mix(in oklab, var(--brand-indigo) 70%, #5c5ad1), var(--brand-indigo))",
  teal: "linear-gradient(165deg, color-mix(in oklab, var(--brand-teal) 80%, white), var(--brand-teal))",
  gold: "linear-gradient(165deg, color-mix(in oklab, var(--brand-gold) 80%, white), var(--brand-gold))",
};

const TILE_ICON: Partial<Record<BackgroundId, LucideIcon>> = {
  none: Aperture,
  blur: CloudFog,
  studio: Lightbulb,
  stage: Drama,
  arena: Users,
};

/**
 * Horizontal tray of rectangular background previews — each tile shows an actual (scaled-down)
 * preview of the real scene from virtual-background.ts, not just an abstract icon, so scrolling
 * through it reads like flipping through a camera app's filter tray: you can tell what you're
 * about to get before tapping it. Tap one to change the selfie camera's live backdrop; the choice
 * stays visibly locked in (bright ring + glow + checkmark) until changed again.
 */
export function BackgroundPicker({
  value,
  onChange,
  disabled,
}: {
  value: BackgroundId;
  onChange: (id: BackgroundId) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-0.5 pt-1">
      {BACKGROUND_OPTIONS.map(({ id, labelKey }) => {
        const Icon = TILE_ICON[id];
        const selected = value === id;
        return (
          <motion.button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            disabled={disabled}
            whileTap={disabled ? undefined : { scale: 0.93 }}
            aria-pressed={selected}
            aria-label={t(labelKey)}
            className="relative h-24 w-16 shrink-0 overflow-hidden rounded-2xl outline-none transition-shadow disabled:opacity-50"
            style={{
              background: TILE_BACKGROUND[id],
              boxShadow: selected
                ? "0 0 0 2.5px var(--card), 0 0 0 4.5px var(--primary), var(--shadow-pop-coral)"
                : "0 0 0 1px color-mix(in oklab, var(--foreground) 8%, transparent)",
            }}
          >
            {Icon && (
              <span className="absolute inset-0 grid place-items-center">
                <Icon className="h-6 w-6 text-white/90 drop-shadow" />
              </span>
            )}
            {selected && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="absolute end-1 top-1 grid h-4.5 w-4.5 place-items-center rounded-full bg-primary text-primary-foreground shadow"
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </motion.span>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent pb-1 pt-4">
              <span className="block truncate px-1 text-center text-[10px] font-semibold text-white">
                {t(labelKey)}
              </span>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
