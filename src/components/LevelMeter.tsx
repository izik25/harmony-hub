import { cn } from "@/lib/utils";

/**
 * A row of input-meter bars: the Studio26 signature. Static heights at rest; with `live` the bars
 * breathe like a channel meter catching a signal; with `resting` they sit flat and unlit, a channel
 * with no signal yet (used by empty states). Purely decorative (aria-hidden), and the motion stops
 * under prefers-reduced-motion (see .meter-bar in styles.css).
 */
const HEIGHTS = [28, 46, 64, 38, 82, 58, 94, 70, 52, 88, 60, 40, 72, 48, 30, 56, 78, 44, 26, 36];
const RESTING = [34, 48, 28, 56, 40, 30, 46, 26, 52, 36, 44, 30];

export function LevelMeter({
  bars = 20,
  live = false,
  resting = false,
  className,
}: {
  bars?: number;
  live?: boolean;
  resting?: boolean;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("flex h-full items-end gap-[3px]", className)}>
      {Array.from({ length: bars }).map((_, i) => {
        if (resting) {
          return (
            <span
              key={i}
              className="w-full flex-1 rounded-[2px] bg-white/22"
              style={{ height: `${RESTING[i % RESTING.length]}%` }}
            />
          );
        }
        const h = HEIGHTS[i % HEIGHTS.length];
        return (
          <span
            key={i}
            className={cn("meter-bar w-full flex-1 rounded-[2px]", live && "meter-bar--live")}
            style={{
              height: `${h}%`,
              // The gradient is sized to the whole meter, not the bar, so colour marks absolute
              // level like a real channel meter: marigold body, turning coral only near the top.
              backgroundImage:
                "linear-gradient(to top, var(--brand-gold) 0%, var(--brand-gold) 62%, var(--coral-text) 82%, var(--brand-coral) 100%)",
              backgroundSize: `100% ${(100 / h) * 100}%`,
              backgroundPosition: "bottom",
              backgroundRepeat: "no-repeat",
              animationDelay: `${(i * 137) % 900}ms`,
              animationDuration: `${900 + ((i * 53) % 500)}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
