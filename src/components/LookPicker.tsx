import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { LOOK_OPTIONS, LOOK_FILTERS, LOOK_BEAUTY, type LookId } from "@/lib/video-filters";
import { loadFaceLandmarker } from "@/lib/face-filters";

// Every tile previews the same base gradient (a warm, portrait-ish swatch) through the look's own
// CSS `filter` string — the exact same string camera-effects.ts applies to the live camera feed —
// so a tile shows the real grade rather than an abstract icon standing in for it, the same "actual
// preview, not a symbol" idea BackgroundPicker uses for its scene thumbnails.
const SWATCH = "linear-gradient(155deg, #e8b487 0%, #c97d5a 45%, #6b3f3a 100%)";

// Fixed freckle scatter for the freckles tile (x%, y%, size px).
const FRECKLE_DOTS: [number, number, number][] = [
  [30, 40, 2],
  [38, 46, 1.5],
  [44, 38, 2.5],
  [52, 44, 1.5],
  [58, 39, 2],
  [66, 45, 2.5],
  [70, 38, 1.5],
  [26, 50, 1.5],
  [34, 54, 2],
  [48, 52, 1.5],
  [56, 55, 2],
  [62, 50, 1.5],
  [74, 52, 2],
  [40, 60, 1.5],
  [60, 61, 1.5],
  [50, 34, 1.5],
];

function EyeArt({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 64 40" className="absolute inset-x-1 top-6 w-[calc(100%-0.5rem)]" aria-hidden>
      <path d="M4 20 Q32 -2 60 20 Q32 42 4 20 Z" fill="#f6efe9" />
      <circle cx="32" cy="20" r="11" fill={color} />
      <circle cx="32" cy="20" r="11" fill="none" stroke="rgba(20,25,35,0.45)" strokeWidth="2" />
      <circle cx="32" cy="20" r="4.5" fill="#15161a" />
      <circle cx="35.5" cy="16.5" r="2.2" fill="#fff" />
      <path d="M4 20 Q32 -2 60 20" fill="none" stroke="#3a2620" strokeWidth="2.2" />
    </svg>
  );
}

/** Decorations painted over the swatch for the face-tracked looks, which a CSS grade can't show. */
function TileArt({ id }: { id: LookId }) {
  switch (id) {
    case "photoshoot":
      return (
        <>
          <span
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 50% 38%, rgba(255,255,255,0.45), transparent 55%), radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,0.35))",
            }}
          />
          <svg viewBox="0 0 24 24" className="absolute start-1.5 top-1.5 h-3.5 w-3.5" aria-hidden>
            <path d="M12 2l2 7 7 3-7 3-2 7-2-7-7-3 7-3z" fill="#fff" />
          </svg>
        </>
      );
    case "freckles":
      return (
        <>
          {FRECKLE_DOTS.map(([x, y, s], i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                width: s * 1.4,
                height: s * 1.4,
                background: "rgba(110,58,34,0.75)",
              }}
            />
          ))}
        </>
      );
    case "blush":
      return (
        <span
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 30% 18% at 28% 48%, rgba(240,90,120,0.75), transparent), radial-gradient(ellipse 30% 18% at 72% 48%, rgba(240,90,120,0.75), transparent), radial-gradient(ellipse 22% 7% at 50% 42%, rgba(240,90,120,0.55), transparent)",
          }}
        />
      );
    case "lips":
      return (
        <svg
          viewBox="0 0 64 40"
          className="absolute inset-x-1 top-7 w-[calc(100%-0.5rem)]"
          aria-hidden
        >
          <path
            d="M6 20 Q16 8 26 11 Q32 13 38 11 Q48 8 58 20 Q46 34 32 34 Q18 34 6 20 Z"
            fill="#c4264a"
          />
          <path d="M6 20 Q32 24 58 20" fill="none" stroke="#7a1028" strokeWidth="1.6" />
          <ellipse cx="32" cy="28" rx="8" ry="2" fill="rgba(255,255,255,0.55)" />
        </svg>
      );
    case "eyesBlue":
      return <EyeArt color="#4f9ae6" />;
    case "eyesGreen":
      return <EyeArt color="#4fae63" />;
    default:
      return null;
  }
}

/**
 * Horizontal tray of "filter" previews: the face-tracked beauty looks (photoshoot retouch,
 * freckles, eye color, blush, lips) followed by the whole-frame grades (HD, vivid, warm, black &
 * white...). Tap one to change the selfie camera's live look; baked into the recording the same
 * way a background is, so it also carries straight through to publish.
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
  // Same warm-up as OverlayPicker: the beauty looks need the face model, and starting its load the
  // moment the tray opens means the effect shows right after the tap.
  useEffect(() => {
    loadFaceLandmarker().catch(() => {});
  }, []);
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
            {LOOK_BEAUTY[id] && <TileArt id={id} />}
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
              <span className="line-clamp-2 px-1 text-center text-[10px] font-semibold leading-tight text-white">
                {t(labelKey)}
              </span>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
