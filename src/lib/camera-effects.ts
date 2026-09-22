/**
 * Second compositing stage for the selfie camera, layered on top of virtual-background.ts's
 * output: applies a whole-frame "look" grade (video-filters.ts) and/or a persistent, face-tracked
 * overlay prop (a hat/mask/crown/etc. — reusing face-filters.ts's bitmaps and anchoring math, but
 * pinned for the whole take instead of fading out after a few seconds like a gift). Both are baked
 * into the canvas this returns, so — same as background replacement — what's shown in the preview
 * is exactly what gets recorded and later published.
 *
 * Kept as its own stage (rather than folded into virtual-background.ts) so the common case of "no
 * look, no overlay" stays on record.tsx's existing fast path: a background composer only spins up
 * when a background is actually picked, and this stage only spins up when a look or overlay is.
 * Chaining two canvas passes when both a background AND a look/overlay are active costs one extra
 * drawImage per frame plus, when an overlay is on, one extra MediaPipe face-detection call — the
 * same per-frame cost the transient gift filters already pay today, just persistent instead of a
 * one-off 4.5s effect.
 */
import type { FilterKind } from "./face-filters";
import {
  FILTER_SPECS,
  computeFaceAnchor,
  getFilterBitmap,
  loadFaceLandmarker,
} from "./face-filters";
import type { LookId } from "./video-filters";
import { LOOK_FILTERS } from "./video-filters";

const OUTPUT_FPS = 24;

export interface CameraEffectsComposer {
  /** The graded/decorated feed — feed this into the recorder/preview instead of the input stream. */
  stream: MediaStream;
  setLook(id: LookId): void;
  setOverlay(kind: FilterKind | null): void;
  stop(): void;
}

/**
 * Starts the grade → overlay → redraw loop against `video` (expected to already be playing the
 * upstream feed — either the raw camera or a virtual-background composer's output) and returns a
 * canvas-backed MediaStream with both effects applied live. Never mutates or reads from `video`'s
 * srcObject — same convention as startVirtualBackground.
 */
export async function startCameraEffects(
  video: HTMLVideoElement,
  initial: { lookId: LookId; overlayKind: FilterKind | null },
): Promise<CameraEffectsComposer> {
  const width = video.videoWidth || 480;
  const height = video.videoHeight || 854;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  let lookId = initial.lookId;
  let overlayKind = initial.overlayKind;
  let running = true;
  let raf = 0;

  // Loaded lazily (and kept around once loaded — swapping props/looks shouldn't reload the
  // landmarker) so picking a look without ever touching the overlay tray never pays for face
  // tracking at all.
  let landmarker: Awaited<ReturnType<typeof loadFaceLandmarker>> | null = null;
  let landmarkerLoading = false;
  let overlayBitmap: ImageBitmap | null = null;
  let bitmapFor: FilterKind | null = null;

  function ensureOverlayAssets(kind: FilterKind) {
    if (!landmarker && !landmarkerLoading) {
      landmarkerLoading = true;
      loadFaceLandmarker()
        .then((lm) => {
          landmarker = lm;
        })
        .finally(() => {
          landmarkerLoading = false;
        });
    }
    if (bitmapFor !== kind) {
      bitmapFor = kind;
      overlayBitmap = null;
      getFilterBitmap(kind).then((bmp) => {
        if (bitmapFor === kind) overlayBitmap = bmp;
      });
    }
  }
  if (overlayKind) ensureOverlayAssets(overlayKind);

  const drawFrame = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(drawFrame);
    if (video.readyState < 2) return;

    ctx.filter = LOOK_FILTERS[lookId] ?? "none";
    ctx.drawImage(video, 0, 0, width, height);
    ctx.filter = "none";

    if (overlayKind && landmarker && overlayBitmap) {
      const spec = FILTER_SPECS[overlayKind];
      const result = landmarker.detectForVideo(video, Math.round(now));
      const face = result.faceLandmarks?.[0];
      if (face) {
        // Canvas is sized exactly to the video's own native resolution and drawn 1:1 above (no
        // object-cover cropping happens here, unlike the DOM preview box in face-filters.ts) — so
        // vw/vh double as the "box" too, coverScale is 1 and there's no letterbox offset.
        const { point, angle, scale } = computeFaceAnchor(spec, face, width, height, 1, 0, 0);
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.rotate(angle);
        ctx.scale(scale, scale);
        ctx.drawImage(overlayBitmap, -spec.bitmapAnchor.x, -spec.bitmapAnchor.y);
        ctx.restore();
      }
    }
  };
  raf = requestAnimationFrame(drawFrame);

  const stream = (
    canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }
  ).captureStream(OUTPUT_FPS);

  return {
    stream,
    setLook(id: LookId) {
      lookId = id;
    },
    setOverlay(kind: FilterKind | null) {
      overlayKind = kind;
      if (kind) ensureOverlayAssets(kind);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
