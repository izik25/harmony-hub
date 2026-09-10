import { useEffect, useRef } from "react";
import { playFaceFilter, type FilterKind, type FaceFilterPlayer } from "@/lib/face-filters";

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
    }).then((player) => {
      if (cancelled) player.stop();
      else playerRef.current = player;
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
