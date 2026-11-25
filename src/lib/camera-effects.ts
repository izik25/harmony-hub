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
  createFaceTracker,
  getFilterBitmap,
} from "./face-filters";
import type { Props3DRenderer } from "./props-3d";
import type { LookId } from "./video-filters";
import { LOOK_BEAUTY, LOOK_FILTERS } from "./video-filters";
import {
  createBeautyRenderer,
  createLandmarkSmoother,
  recipeNeedsFace,
  type BeautyRenderer,
} from "./beauty-effects";

// Detection cadence while a face-tracked beauty look is on (see FaceTracker.track's intervalMs).
const BEAUTY_DETECT_MS = 40;

const OUTPUT_FPS = 24;
// Redraw cap: a little over OUTPUT_FPS so the captured stream never repeats a frame it didn't
// have to (rAF ticks don't line up exactly with the capture clock).
const MIN_FRAME_MS = 1000 / 32;

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
  let lastDrawAt = -Infinity;

  // Created lazily (and kept around once created — swapping props/looks shouldn't reload the
  // model) so picking a look without ever touching the overlay tray never pays for face tracking.
  let tracker: ReturnType<typeof createFaceTracker> | null = null;
  let overlayBitmap: ImageBitmap | null = null;
  let bitmapFor: FilterKind | null = null;

  // The real 3D props (props-3d.ts) — three.js is fetched the first time a prop is picked.
  // undefined while that's loading (nothing drawn rather than flashing the 2D sticker first),
  // null if this device can't do WebGL, in which case the 2D sticker is the fallback.
  let props3d: Props3DRenderer | null | undefined;
  let props3dLoading = false;

  function ensureOverlayAssets(kind: FilterKind) {
    if (!tracker) tracker = createFaceTracker();
    if (props3d === undefined && !props3dLoading) {
      props3dLoading = true;
      import("./props-3d")
        .then((mod) => {
          props3d = mod.getProps3DRenderer();
        })
        .catch((err) => {
          console.error(err);
          props3d = null;
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

  // Beauty looks (photoshoot, freckles, eye color...) — scratch canvases only built once one is
  // actually picked, and the face tracker only when the look needs a face.
  let beauty: BeautyRenderer | null = null;
  function ensureBeauty(id: LookId) {
    const recipe = LOOK_BEAUTY[id];
    if (!recipe) return;
    if (!beauty) beauty = createBeautyRenderer(width, height);
    if (recipeNeedsFace(recipe) && !tracker) tracker = createFaceTracker();
  }
  ensureBeauty(lookId);

  // Steadies the landmarks so makeup and props sit on the face instead of shimmering on it.
  const smoothFace = createLandmarkSmoother(width, height);

  const drawFrame = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(drawFrame);
    if (video.readyState < 2) return;
    // The output stream is OUTPUT_FPS; redrawing at the display's rate (120Hz on many phones)
    // only burns battery — and with a 3D prop on, a full WebGL render per redraw.
    if (now - lastDrawAt < MIN_FRAME_MS) return;
    lastDrawAt = now;

    ctx.filter = LOOK_FILTERS[lookId] ?? "none";
    ctx.drawImage(video, 0, 0, width, height);
    ctx.filter = "none";

    const recipe = LOOK_BEAUTY[lookId];
    const beautyFace = recipeNeedsFace(recipe);
    // One detection per frame, shared by the beauty pass and the overlay prop.
    const face = smoothFace(
      tracker && (overlayKind || beautyFace)
        ? tracker.track(video, now, beautyFace ? BEAUTY_DETECT_MS : undefined)
        : null,
      now,
    );

    if (recipe && beauty) beauty.draw(ctx, face, recipe);

    const props3dFrame =
      overlayKind && face && props3d ? props3d.render(face, overlayKind, width, height) : null;
    if (props3dFrame) {
      ctx.drawImage(props3dFrame, 0, 0, width, height);
    } else if (overlayKind && tracker && props3d !== undefined) {
      const spec = FILTER_SPECS[overlayKind];
      if (face && overlayBitmap) {
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
      ensureBeauty(id);
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
