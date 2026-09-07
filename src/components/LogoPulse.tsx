import { motion } from "framer-motion";

/**
 * The app's logo mark, breathing/bobbing in a loop with expanding rings behind it — a generic
 * "something's playing/processing" indicator, used wherever a wait is long or ambiguous enough
 * (video finishing, a splice re-encoding) that a plain spinner isn't a clear enough signal that
 * something is actually happening.
 */
export function LogoPulse({
  label,
  size = 64,
  labelClassName = "text-foreground",
}: {
  label?: string;
  size?: number;
  labelClassName?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div
        className="relative grid place-items-center"
        style={{ width: size + 36, height: size + 36 }}
      >
        {[0, 1].map((i) => (
          <motion.span
            key={i}
            aria-hidden
            className="absolute rounded-2xl border-2 border-brand-coral"
            style={{ width: size, height: size }}
            animate={{ scale: [1, 1.55], opacity: [0.5, 0] }}
            transition={{ duration: 1.7, repeat: Infinity, ease: "easeOut", delay: i * 0.85 }}
          />
        ))}
        <motion.img
          src="/brand/logo-mark.png"
          alt=""
          className="relative rounded-2xl shadow-pop-coral"
          style={{ width: size, height: size }}
          animate={{ scale: [1, 1.09, 1], rotate: [0, -4, 4, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      {label && <p className={`text-sm font-semibold ${labelClassName}`}>{label}</p>}
    </div>
  );
}
