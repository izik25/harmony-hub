import { useEffect, useRef, useState } from "react";
import {
  faceFxDebug,
  playFaceFilter,
  type FilterKind,
  type FaceFilterPlayer,
} from "@/lib/face-filters";

/**
 * Absolutely-positioned canvas that draws a face-tracked filter effect over `videoRef`'s current
 * frame for a few seconds, then calls `onDone`. Purely a live, on-screen show effect (see
 * face-filters.ts) — never touches the video's own stream, so it has no effect on what actually
 * gets recorded. Mount this as a sibling of the `<video>` element inside a `position: relative`
 * wrapper sized to exactly match it.
 */
export function FaceFilterOverlay({
  videoRef,
  kind,
  onDone,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  kind: FilterKind | null;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<FaceFilterPlayer | null>(null);

  useEffect(() => {
    if (!kind) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    let cancelled = false;
    playFaceFilter(canvas, video, kind, () => {
      if (!cancelled) onDone();
    })
      .then((player) => {
        if (cancelled) player.stop();
        else playerRef.current = player;
      })
      // The face model couldn't load at all: end the effect rather than leave it "playing".
      .catch(() => {
        if (!cancelled) onDone();
      });

    return () => {
      cancelled = true;
      playerRef.current?.stop();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  if (!kind) return null;
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/**
 * Face-tracking status readout, shown only with ?fxdebug in the URL — for checking on a real phone
 * why a prop or gift filter isn't appearing (model loading? which delegate? finding a face?).
 */
export function FaceFxDebug() {
  const [enabled, setEnabled] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    setEnabled(new URLSearchParams(window.location.search).has("fxdebug"));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [enabled]);
  if (!enabled) return null;
  const d = faceFxDebug;
  return (
    <pre className="pointer-events-none absolute start-3 top-32 z-30 max-w-[60%] whitespace-pre-wrap rounded-lg bg-black/80 p-2 font-mono text-[10px] leading-snug text-lime-300">
      {`delegate: ${d.delegate}
status: ${d.status}
detections: ${d.detections}
faces: ${d.faces}${
        d.lastError
          ? `
error: ${d.lastError.slice(0, 160)}`
          : ""
      }`}
    </pre>
  );
}
