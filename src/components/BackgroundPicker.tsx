import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Aperture, CloudFog, Check } from "lucide-react";
import { BACKGROUND_OPTIONS, type BackgroundId } from "@/lib/virtual-background";
import { renderBackgroundThumbnail } from "@/lib/background-scenes";

// Thumbnails are rendered at 2× the tile's CSS size so they stay crisp on retina screens.
const THUMB_W = 128;
const THUMB_H = 192;

// "none" and "blur" have no painted scene to preview — they get a dark neutral tile with an icon.
const ICON_TILES: Partial<Record<BackgroundId, { bg: string; Icon: typeof Aperture }>> = {
  none: { bg: "linear-gradient(165deg, #4b5563, #1c2330)", Icon: Aperture },
  blur: {
    bg: "linear-gradient(150deg, color-mix(in oklab, var(--brand-teal) 55%, #101820) 0%, #10161c 100%)",
    Icon: CloudFog,
  },
};

/**
 * Renders every scene's real thumbnail (the same painters the live composer uses, with a
 * stand-in silhouette where the singer goes) once, then hands back id → data URL. Rendering is
 * spread over animation frames so opening the tray never blocks on painting all of them at once.
 */
function useThumbnails() {
  const [thumbs, setThumbs] = useState<Partial<Record<BackgroundId, string>>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const { id } of BACKGROUND_OPTIONS) {
        if (ICON_TILES[id]) continue;
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        if (cancelled) return;
        const url = await renderBackgroundThumbnail(id, THUMB_W, THUMB_H);
        if (cancelled) return;
        if (url) setThumbs((prev) => ({ ...prev, [id]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return thumbs;
}

/**
 * Horizontal tray of rectangular background previews — each tile is an actual scaled-down render
 * of the scene, not an abstract icon, so scrolling through it reads like flipping through a camera
 * app's filter tray. Tap one to change the selfie camera's live backdrop; the choice stays visibly
 * locked in (bright ring + glow + checkmark) until changed again.
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
  const thumbs = useThumbnails();
  return (
    <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-0.5 pt-1">
      {BACKGROUND_OPTIONS.map(({ id, labelKey }) => {
        const iconTile = ICON_TILES[id];
        const thumb = thumbs[id];
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
            className="relative h-24 w-16 shrink-0 overflow-hidden rounded-2xl bg-[#111116] outline-none transition-shadow disabled:opacity-50"
            style={{
              background: iconTile?.bg,
              boxShadow: selected
                ? "0 0 0 2.5px var(--card), 0 0 0 4.5px var(--primary), var(--shadow-pop-coral)"
                : "0 0 0 1px color-mix(in oklab, var(--foreground) 8%, transparent)",
            }}
          >
            {thumb && (
              <motion.img
                src={thumb}
                alt=""
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
            )}
            {iconTile && (
              <span className="absolute inset-0 grid place-items-center">
                <iconTile.Icon className="h-6 w-6 text-white/90 drop-shadow" />
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
