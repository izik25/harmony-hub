import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { LOOK_OPTIONS, LOOK_FILTERS, type LookId } from "@/lib/video-filters";

// Every tile previews the same base gradient (a warm, portrait-ish swatch) through the look's own
// CSS `filter` string — the exact same string camera-effects.ts applies to the live camera feed —
// so a tile shows the real grade rather than an abstract icon standing in for it, the same "actual
// preview, not a symbol" idea BackgroundPicker uses for its scene thumbnails.
const SWATCH = "linear-gradient(155deg, #e8b487 0%, #c97d5a 45%, #6b3f3a 100%)";

/**
 * Horizontal tray of whole-frame "look" filter previews (Photoshop/Instagram-style grading — HD,
 * vivid, warm, black & white...). Tap one to change the selfie camera's live grade; baked into the
 * recording the same way a background is, so it also carries straight through to publish.
 */
export function LookPicker({
  value,
  onChange,
  disabled,
}: {
  value: LookId;
  onChange: (id: LookId) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-0.5 pt-1">
      {LOOK_OPTIONS.map(({ id, labelKey }) => {
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
              boxShadow: selected
                ? "0 0 0 2.5px var(--card), 0 0 0 4.5px var(--primary), var(--shadow-pop-coral)"
                : "0 0 0 1px color-mix(in oklab, var(--foreground) 8%, transparent)",
            }}
          >
            {/* The look's own filter lives on this background-only layer, never on the checkmark
                or label above it — a CSS filter composites its whole subtree as one image, so
                anything that needs to read the same regardless of grade (e.g. the white checkmark
                surviving the black & white look) has to sit outside it, not just override it. */}
            <span
              className="absolute inset-0"
              style={{ background: SWATCH, filter: LOOK_FILTERS[id] }}
            />
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
