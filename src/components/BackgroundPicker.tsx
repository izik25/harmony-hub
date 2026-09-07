import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Aperture, CloudFog, Lightbulb, Drama, Users, Check, type LucideIcon } from "lucide-react";
import { BACKGROUND_OPTIONS, type BackgroundId } from "@/lib/virtual-background";

// Approximates each real, canvas-rendered scene from virtual-background.ts using plain CSS
// gradients — cheap to render as a picker thumbnail without spinning up the segmentation model
// or drawing to an actual canvas just to preview a swatch.
const CHIP_BACKGROUND: Record<BackgroundId, string> = {
  none: "linear-gradient(135deg, var(--muted), var(--card))",
  blur: "linear-gradient(135deg, rgba(255,255,255,0.35), rgba(255,255,255,0.08))",
  studio:
    "radial-gradient(circle at 25% 20%, rgba(245,240,230,0.55), transparent 55%), linear-gradient(160deg, #2a2e37, #101217)",
  stage:
    "radial-gradient(circle at 50% 12%, rgba(255,243,214,0.6), transparent 45%), linear-gradient(180deg, #0c0d12 0%, #15161d 65%, #2b1d14 100%)",
  arena:
    "radial-gradient(circle at 50% 6%, rgba(255,255,255,0.35), transparent 40%), linear-gradient(200deg, color-mix(in oklab, var(--brand-teal) 55%, transparent) 0%, transparent 45%), linear-gradient(150deg, color-mix(in oklab, var(--brand-coral) 55%, transparent) 0%, transparent 45%), linear-gradient(180deg, #08080d, #141018)",
  green: "#12b350",
  blue: "#1565d8",
  coral: "var(--brand-coral)",
  indigo: "var(--brand-indigo)",
  teal: "var(--brand-teal)",
  gold: "var(--brand-gold)",
};

const CHIP_ICON: Partial<Record<BackgroundId, LucideIcon>> = {
  none: Aperture,
  blur: CloudFog,
  studio: Lightbulb,
  stage: Drama,
  arena: Users,
};

/**
 * Horizontal scroll strip of background swatches — tap one to change the selfie camera's live
 * backdrop (see virtual-background.ts for the actual real-time compositing). Mirrors the
 * effect-tray pattern from other camera apps: scroll to browse, tap to lock one in, the choice
 * stays selected (highlighted ring + checkmark) until changed again.
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
    <div
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5"
      style={{ scrollbarWidth: "none" }}
    >
      {BACKGROUND_OPTIONS.map(({ id, labelKey }) => {
        const Icon = CHIP_ICON[id];
        const selected = value === id;
        return (
          <motion.button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            disabled={disabled}
            whileTap={disabled ? undefined : { scale: 0.94 }}
            aria-pressed={selected}
            aria-label={t(labelKey)}
            className="flex shrink-0 flex-col items-center gap-1 disabled:opacity-50"
          >
            <span
              className={`relative grid h-12 w-12 place-items-center rounded-full ring-2 transition-shadow ${
                selected ? "ring-primary shadow-pop" : "ring-transparent"
              }`}
              style={{ background: CHIP_BACKGROUND[id] }}
            >
              {Icon && <Icon className="h-5 w-5 text-white drop-shadow" />}
              {selected && (
                <span className="absolute -bottom-0.5 -end-0.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-2.5 w-2.5" />
                </span>
              )}
            </span>
            <span className="max-w-14 truncate text-[10px] text-muted-foreground">
              {t(labelKey)}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
