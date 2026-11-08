/**
 * Real-time virtual backgrounds for the selfie camera — the same idea as the background pickers
 * in video-call apps: an on-device ML model (MediaPipe's selfie segmenter, run fully in-browser
 * via WASM, never uploaded anywhere) tells us which pixels of each camera frame are "person", and
 * every other pixel gets replaced by whichever backdrop the user picked, live, before it's ever
 * recorded. No physical green screen required.
 *
 * The model (public/models/selfie_segmenter.tflite) and the WASM runtime
 * (public/mediapipe/wasm, copied from node_modules/@mediapipe/tasks-vision/wasm at install time)
 * are both served from this app's own origin rather than Google's CDN, so this works offline once
 * cached and doesn't depend on a third party staying up. Both are only fetched once the camera is
 * on with a non-"none" background — which, since the branded "brand" backdrop is the default, is
 * most camera sessions; picking "none" still skips all of it.
 *
 * The scenes themselves live in background-scenes.ts. The output is mirrored (the singer is drawn
 * flipped, the scene is not), so a selfie preview shown as-is reads like a mirror *and* any text in
 * the scene — the Studio 26 logo, an ON AIR sign — reads the right way round, both in the preview
 * and in the recorded take.
 *
 * @mediapipe/tasks-vision itself (~150KB of JS, separate from the WASM/model bytes above) is
 * dynamically imported inside loadSegmenter() rather than at module top level — this file is a
 * static import of record.tsx, so importing the library eagerly here would have put that weight
 * into every visit to the record page, camera or no camera, background or no background.
 */
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  getSceneDef,
  loadSceneAssets,
  type BackgroundId,
  type SceneAssets,
} from "./background-scenes";

export {
  BACKGROUND_OPTIONS,
  DEFAULT_BACKGROUND,
  MIC_BACKGROUNDS,
  isBackgroundId,
  type BackgroundId,
} from "./background-scenes";

// Static layers (a scene's backdrop, and the mic in front of the singer for the mic scenes) never
// change frame-to-frame, so each one is painted once per output size and reused as an
// ImageBitmap — the per-frame cost is then just a cheap drawImage, same as the camera frame itself.
type Layer = "bg" | "fg";
const layerCache = new Map<string, ImageBitmap | null>();
const layerKey = (id: BackgroundId, layer: Layer, w: number, h: number) =>
  `${id}:${layer}:${w}x${h}`;

async function paintLayer(id: BackgroundId, layer: Layer, w: number, h: number): Promise<void> {
  const key = layerKey(id, layer, w, h);
  if (layerCache.has(key)) return;
  const def = getSceneDef(id);
  const painter = layer === "bg" ? def?.paint : def?.foreground;
  if (!painter) {
    layerCache.set(key, null);
    return;
  }
  const assets: SceneAssets = await loadSceneAssets();
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  painter(canvas.getContext("2d")!, w, h, assets);
  layerCache.set(key, await createImageBitmap(canvas));
}

/** Synchronous cache-only lookup for the per-frame loop: a bitmap, null (scene has no such
 *  layer), or undefined (not painted yet). Never awaits/allocates. */
function getLayerCached(id: BackgroundId, layer: Layer, w: number, h: number) {
  return layerCache.get(layerKey(id, layer, w, h));
}

let segmenterPromise: Promise<ImageSegmenter> | null = null;
function loadSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = import("@mediapipe/tasks-vision").then(
      async ({ FilesetResolver, ImageSegmenter }) => {
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const options = {
          runningMode: "VIDEO" as const,
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        };
        try {
          return await ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: "/models/selfie_segmenter.tflite", delegate: "GPU" },
            ...options,
          });
        } catch {
          // Some devices/browsers lack a WebGL2 context capable of running the GPU delegate —
          // CPU is slower but works everywhere the WASM runtime itself loads.
          return ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: "/models/selfie_segmenter.tflite", delegate: "CPU" },
            ...options,
          });
        }
      },
    );
  }
  return segmenterPromise;
}

// Kept modest on purpose: this feed is only ever shown as a small picture-in-picture (and, per
// camera-capture.ts, was already capped to a "modest" capture resolution for the same reason) —
// a lower frame rate here directly cuts how much per-frame segmentation/compositing work the main
// thread has to do, which is what was making the whole page feel sluggish while a background was
// active, not just the preview itself.
const OUTPUT_FPS = 18;

export interface VirtualBackgroundComposer {
  /** The live, background-replaced feed — feed this into the recorder/preview instead of the raw camera stream. */
  stream: MediaStream;
  setBackground(id: BackgroundId): void;
  stop(): void;
}

/**
 * Starts the segment → composite → redraw loop against `video` (expected to already be playing
 * the raw camera stream) and returns a canvas-backed MediaStream with the chosen background
 * composited in, live. Never mutates or reads from `video`'s srcObject — callers keep the raw
 * camera stream alive and pass this hidden/offscreen `<video>` in purely as a frame source.
 *
 * The returned stream is already mirrored (see the file header) — callers should show it without
 * a CSS flip.
 */
export async function startVirtualBackground(
  video: HTMLVideoElement,
  initial: Exclude<BackgroundId, "none">,
): Promise<VirtualBackgroundComposer> {
  const segmenter = await loadSegmenter();

  const width = video.videoWidth || 480;
  const height = video.videoHeight || 854;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext("2d")!;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d")!;

  const personCanvas = document.createElement("canvas");
  personCanvas.width = width;
  personCanvas.height = height;
  const personCtx = personCanvas.getContext("2d")!;

  let backgroundId: BackgroundId = initial;
  let running = true;
  let raf = 0;
  let lastFrameAt = 0;
  const startedAt = performance.now();
  const frameInterval = 1000 / OUTPUT_FPS;
  // Reused frame over frame instead of calling createImageData() every tick — that used to
  // allocate a fresh backing buffer the size of the whole frame (megabytes/sec of garbage at this
  // frame rate), which is what was actually behind the page-wide jank: a canvas draw call is
  // cheap, but the GC pauses from that churn block the main thread same as any other JS would.
  // Only reallocated on the rare frame where the segmenter's own output size actually changes.
  let maskImageData: ImageData | null = null;
  // Layers already being painted, so a frame that finds one missing kicks it off exactly once.
  const pending = new Set<string>();
  const ensureLayer = (layer: "bg" | "fg") => {
    const cached = getLayerCached(backgroundId, layer, width, height);
    if (cached !== undefined) return cached;
    const key = `${backgroundId}:${layer}`;
    if (!pending.has(key)) {
      pending.add(key);
      paintLayer(backgroundId, layer, width, height).finally(() => pending.delete(key));
    }
    return undefined;
  };

  // Draws the camera frame flipped horizontally — the mirror view — at full output size.
  const drawMirrored = (ctx: CanvasRenderingContext2D, src: CanvasImageSource) => {
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0, width, height);
    ctx.restore();
  };

  const drawFrame = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(drawFrame);
    if (now - lastFrameAt < frameInterval) return;
    lastFrameAt = now;
    if (video.readyState < 2) return;

    segmenter.segmentForVideo(video, Math.round(now), (result) => {
      const confidence = result.confidenceMasks?.[0];
      if (!confidence) return;
      const mask = confidence.getAsFloat32Array();
      // The mask's own resolution isn't guaranteed to match the video's — resize the mask canvas
      // to fit it exactly, then let drawImage below scale it back up to output size.
      if (maskCanvas.width !== confidence.width || maskCanvas.height !== confidence.height) {
        maskCanvas.width = confidence.width;
        maskCanvas.height = confidence.height;
        maskImageData = null;
      }
      if (!maskImageData) {
        maskImageData = maskCtx.createImageData(confidence.width, confidence.height);
      }
      const data = maskImageData.data;
      for (let i = 0; i < mask.length; i++) {
        // Only the alpha channel matters below (destination-in reads source alpha only).
        data[i * 4 + 3] = Math.round(mask[i] * 255);
      }
      maskCtx.putImageData(maskImageData, 0, 0);
      confidence.close();

      personCtx.clearRect(0, 0, width, height);
      drawMirrored(personCtx, video);
      personCtx.globalCompositeOperation = "destination-in";
      drawMirrored(personCtx, maskCanvas);
      personCtx.globalCompositeOperation = "source-over";

      if (backgroundId === "blur") {
        outCtx.filter = "blur(14px)";
        drawMirrored(outCtx, video);
        outCtx.filter = "none";
        outCtx.drawImage(personCanvas, 0, 0);
        return;
      }
      const def = getSceneDef(backgroundId);
      const bg = ensureLayer("bg");
      const fg = def?.foreground ? ensureLayer("fg") : null;
      if (!bg) {
        // Not painted yet at this size (a few ms on first pick) — show the person over plain
        // near-black for this frame rather than blocking the loop on the paint.
        outCtx.fillStyle = "#050507";
        outCtx.fillRect(0, 0, width, height);
        outCtx.drawImage(personCanvas, 0, 0);
        return;
      }
      outCtx.drawImage(bg, 0, 0);
      if (def?.animate) def.animate(outCtx, width, height, (now - startedAt) / 1000);
      outCtx.drawImage(personCanvas, 0, 0);
      if (fg) outCtx.drawImage(fg, 0, 0);
    });
  };
  raf = requestAnimationFrame(drawFrame);

  const stream = (
    outCanvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }
  ).captureStream(OUTPUT_FPS);

  return {
    stream,
    setBackground(id: BackgroundId) {
      backgroundId = id;
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
