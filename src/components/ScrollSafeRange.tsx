import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A range control that never fights the page scroll.
 *
 * A bare <input type="range"> jumps to wherever a finger lands, so on a phone every swipe that
 * starts on one of the stacked studio sliders silently rewrote a mix value. Here:
 * - touch/pen: nothing changes until the finger clearly moves sideways (DRAG_SLOP px, mostly
 *   horizontal). The drag is relative to the current value, so grabbing anywhere on the row never
 *   makes it jump. A vertical move hands the gesture to the browser (`touch-action: pan-y`), and a
 *   plain tap — including the tap that stops a fling — does nothing unless `tapToJump` is set.
 * - mouse: click or drag jumps to the pointer, as a desktop user expects.
 * - keyboard: arrows / PageUp / PageDown / Home / End, mirrored in RTL like a native range.
 */
const DRAG_SLOP = 8;
const TAP_SLOP = 6;

type Gesture =
  | { mode: "idle" }
  | {
      mode: "pending" | "drag";
      pointerId: number;
      pointerType: string;
      startX: number;
      startY: number;
      startValue: number;
    };

export function ScrollSafeRange({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled = false,
  tapToJump = false,
  ariaLabel,
  ariaValueText,
  className,
  trackClassName,
  fillClassName,
  thumbClassName,
  children,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Touch tap (no movement) jumps to that point. For seek bars, not for mix values. */
  tapToJump?: boolean;
  ariaLabel: string;
  ariaValueText?: string;
  className?: string;
  trackClassName?: string;
  fillClassName?: string;
  thumbClassName?: string;
  /** Extra marks drawn inside the track (e.g. section markers), behind the fill. */
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>({ mode: "idle" });
  const [dragging, setDragging] = useState(false);

  const span = max - min;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
  const decimals = (String(step).split(".")[1] ?? "").length;

  const snap = (raw: number) => {
    const stepped = Math.round((raw - min) / step) * step + min;
    const clamped = Math.min(max, Math.max(min, stepped));
    return Number(clamped.toFixed(decimals));
  };

  const emit = (raw: number) => {
    const next = snap(raw);
    if (next !== value) onChange(next);
  };

  const geometry = () => {
    const el = rootRef.current!;
    const rect = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === "rtl";
    return { rect, rtl };
  };

  const valueAt = (clientX: number) => {
    const { rect, rtl } = geometry();
    if (rect.width <= 0) return value;
    let f = (clientX - rect.left) / rect.width;
    if (rtl) f = 1 - f;
    return min + Math.min(1, Math.max(0, f)) * span;
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    // Touch pointers are already implicitly captured; re-capturing would fire a spurious
    // lostpointercapture mid-gesture.
    try {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    } catch {
      /* pointer already gone */
    }
    setDragging(true);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || span <= 0) return;
    if (e.pointerType === "mouse") {
      if (e.button !== 0) return;
      e.preventDefault();
      rootRef.current?.focus({ preventScroll: true });
      gesture.current = {
        mode: "drag",
        pointerId: e.pointerId,
        pointerType: "mouse",
        startX: e.clientX,
        startY: e.clientY,
        startValue: value,
      };
      startDrag(e);
      emit(valueAt(e.clientX));
      return;
    }
    gesture.current = {
      mode: "pending",
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      startValue: value,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (g.mode === "idle" || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (g.mode === "pending") {
      if (Math.abs(dx) >= DRAG_SLOP && Math.abs(dx) > Math.abs(dy) * 1.2) {
        gesture.current = { ...g, mode: "drag" };
        startDrag(e);
      } else if (Math.abs(dy) >= DRAG_SLOP) {
        // It's a scroll. Let the browser have it.
        gesture.current = { mode: "idle" };
      }
      return;
    }

    e.preventDefault();
    if (g.pointerType === "mouse") {
      emit(valueAt(e.clientX));
      return;
    }
    const { rect, rtl } = geometry();
    if (rect.width <= 0) return;
    const delta = ((rtl ? -dx : dx) / rect.width) * span;
    emit(g.startValue + delta);
  };

  const end = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (g.mode === "idle" || g.pointerId !== e.pointerId) return;
    if (
      !cancelled &&
      tapToJump &&
      g.mode === "pending" &&
      Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < TAP_SLOP
    ) {
      emit(valueAt(e.clientX));
    }
    gesture.current = { mode: "idle" };
    setDragging(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rtl = rootRef.current ? getComputedStyle(rootRef.current).direction === "rtl" : false;
    const big = Math.max(step, span / 10);
    let next: number | null = null;
    switch (e.key) {
      case "ArrowUp":
        next = value + step;
        break;
      case "ArrowDown":
        next = value - step;
        break;
      case "ArrowRight":
        next = value + (rtl ? -step : step);
        break;
      case "ArrowLeft":
        next = value + (rtl ? step : -step);
        break;
      case "PageUp":
        next = value + big;
        break;
      case "PageDown":
        next = value - big;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
    }
    if (next === null) return;
    e.preventDefault();
    emit(next);
  };

  return (
    <div
      ref={rootRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={ariaValueText}
      aria-disabled={disabled || undefined}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
      onKeyDown={onKeyDown}
      style={{ touchAction: "pan-y" }}
      className={cn(
        "group/range relative flex w-full select-none items-center outline-none",
        disabled ? "cursor-default opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <div className={cn("relative w-full rounded-full bg-white/12", trackClassName)}>
        {children}
        <div
          className={cn("absolute inset-y-0 start-0 rounded-full bg-brand-coral", fillClassName)}
          style={{ width: `${fraction * 100}%` }}
        />
        <div
          aria-hidden
          className={cn(
            "absolute top-1/2 h-(--thumb) w-(--thumb) rounded-full bg-white shadow-pop [--thumb:20px]",
            "transition-[scale] duration-150 ease-(--ease-snappy) group-data-[dragging]/range:scale-125",
            "group-focus-visible/range:ring-2 group-focus-visible/range:ring-ring group-focus-visible/range:ring-offset-2 group-focus-visible/range:ring-offset-card",
            thumbClassName,
          )}
          // Logical offset + margin keep the thumb centred on the value in both LTR and RTL.
          style={{
            insetInlineStart: `${fraction * 100}%`,
            marginInlineStart: "calc(var(--thumb) / -2)",
            translate: "0 -50%",
          }}
        />
      </div>
    </div>
  );
}
