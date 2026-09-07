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
 * cached and doesn't depend on a third party staying up. Both are only fetched the first time a
 * non-"none" background is actually selected — a plain camera take pays none of this cost.
 *
 * @mediapipe/tasks-vision itself (~150KB of JS, separate from the WASM/model bytes above) is
 * dynamically imported inside loadSegmenter() rather than at module top level — this file is a
 * static import of record.tsx, so importing the library eagerly here would have put that weight
 * into every visit to the record page, camera or no camera, background or no background.
 */
import type { ImageSegmenter } from "@mediapipe/tasks-vision";

export type BackgroundId =
  | "none"
  | "blur"
  | "studio"
  | "stage"
  | "arena"
  | "green"
  | "blue"
  | "coral"
  | "indigo"
  | "teal"
  | "gold";

export const BACKGROUND_OPTIONS: { id: BackgroundId; labelKey: string }[] = [
  { id: "none", labelKey: "record.bg.none" },
  { id: "blur", labelKey: "record.bg.blur" },
  { id: "studio", labelKey: "record.bg.studio" },
  { id: "stage", labelKey: "record.bg.stage" },
  { id: "arena", labelKey: "record.bg.arena" },
  { id: "green", labelKey: "record.bg.green" },
  { id: "blue", labelKey: "record.bg.blue" },
  { id: "coral", labelKey: "record.bg.coral" },
  { id: "indigo", labelKey: "record.bg.indigo" },
  { id: "teal", labelKey: "record.bg.teal" },
  { id: "gold", labelKey: "record.bg.gold" },
];

const FLAT_COLORS: Partial<Record<BackgroundId, string>> = {
  green: "#12b350",
  blue: "#1565d8",
};

// Reads a brand color CSS variable (defined in oklch in styles.css) through the browser's own
// color engine so canvas fillStyle — which can't reliably parse oklch() the way real CSS can —
// always gets a plain rgb() string that renders the exact same color as the rest of the UI.
const resolvedVarCache = new Map<string, string>();
function resolveCssVar(name: string): string {
  const cached = resolvedVarCache.get(name);
  if (cached) return cached;
  const el = document.createElement("div");
  el.style.color = `var(${name})`;
  el.style.display = "none";
  document.body.appendChild(el);
  const rgb = getComputedStyle(el).color || "#888888";
  document.body.removeChild(el);
  resolvedVarCache.set(name, rgb);
  return rgb;
}

function brandColor(id: "coral" | "indigo" | "teal" | "gold"): string {
  return resolveCssVar(`--brand-${id}`);
}

/** Soft radial "stage light" glow, reused by the studio/stage/arena scenes below. */
function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

function paintStudio(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#2a2e37");
  bg.addColorStop(1, "#101217");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // Two soft "softbox" key lights, the same blurred-flat-glow language as the rest of the app's UI.
  glow(ctx, w * 0.22, h * 0.16, w * 0.6, "#f5f0e6", 0.22);
  glow(ctx, w * 0.82, h * 0.28, w * 0.55, brandColor("teal"), 0.16);
}

function paintStage(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0c0d12");
  bg.addColorStop(0.7, "#15161d");
  bg.addColorStop(1, "#2b1d14");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // A single spotlight cone falling from the top, widening toward the floor.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(w * 0.5, -h * 0.05);
  ctx.lineTo(w * 0.18, h * 0.75);
  ctx.lineTo(w * 0.82, h * 0.75);
  ctx.closePath();
  ctx.clip();
  glow(ctx, w * 0.5, h * 0.1, w * 0.9, "#fff3d6", 0.28);
  ctx.restore();
  // Warm wooden floor gradient along the bottom edge.
  const floor = ctx.createLinearGradient(0, h * 0.82, 0, h);
  floor.addColorStop(0, "transparent");
  floor.addColorStop(1, "#3a2515");
  ctx.fillStyle = floor;
  ctx.fillRect(0, h * 0.82, w, h * 0.18);
}

function paintArena(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#08080d");
  bg.addColorStop(1, "#141018");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // Crossing concert-style light beams in the app's own brand colors.
  const beams: [number, string][] = [
    [0.15, brandColor("coral")],
    [0.4, brandColor("gold")],
    [0.62, brandColor("teal")],
    [0.85, brandColor("indigo")],
  ];
  for (const [xFrac, color] of beams) {
    ctx.save();
    ctx.beginPath();
    const topX = w * xFrac;
    ctx.moveTo(topX - w * 0.03, -h * 0.05);
    ctx.lineTo(topX + w * 0.03, -h * 0.05);
    ctx.lineTo(topX + w * 0.22, h * 0.9);
    ctx.lineTo(topX - w * 0.22, h * 0.9);
    ctx.closePath();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
  glow(ctx, w * 0.5, h * 0.05, w * 0.7, "#ffffff", 0.18);
  // A crowd silhouette: rows of small dark head-shaped ovals along the bottom, backlit by the
  // stage glow above them.
  ctx.fillStyle = "rgba(5,5,8,0.85)";
  const rows = 3;
  for (let r = 0; r < rows; r++) {
    const rowY = h * (0.86 + r * 0.045);
    const radius = w * (0.028 - r * 0.003);
    const count = Math.ceil(w / (radius * 1.7));
    for (let i = 0; i < count; i++) {
      const jitter = ((i * 37 + r * 13) % 10) / 10 - 0.5;
      const x = i * radius * 1.7 + (r % 2 === 0 ? radius * 0.85 : 0);
      ctx.beginPath();
      ctx.ellipse(x, rowY + jitter * radius * 0.4, radius, radius * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintScene(ctx: CanvasRenderingContext2D, id: BackgroundId, w: number, h: number) {
  const flat = FLAT_COLORS[id];
  if (flat) {
    ctx.fillStyle = flat;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (id === "coral" || id === "indigo" || id === "teal" || id === "gold") {
    ctx.fillStyle = brandColor(id);
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (id === "studio") return paintStudio(ctx, w, h);
  if (id === "stage") return paintStage(ctx, w, h);
  if (id === "arena") return paintArena(ctx, w, h);
}

// Static scenes never change frame-to-frame, so each one is painted once per output size and
// reused as an ImageBitmap — the per-frame cost is then just a single cheap drawImage, same as
// drawing the camera frame itself.
const sceneCache = new Map<string, ImageBitmap>();
async function getScene(id: BackgroundId, w: number, h: number): Promise<ImageBitmap> {
  const key = `${id}:${w}x${h}`;
  const cached = sceneCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  paintScene(ctx, id, w, h);
  const bitmap = await createImageBitmap(canvas);
  sceneCache.set(key, bitmap);
  return bitmap;
}

/** Synchronous cache-only lookup, for the per-frame draw loop — never awaits/allocates. */
function getSceneCached(id: BackgroundId, w: number, h: number): ImageBitmap | undefined {
  return sceneCache.get(`${id}:${w}x${h}`);
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
  const frameInterval = 1000 / OUTPUT_FPS;
  // Reused frame over frame instead of calling createImageData() every tick — that used to
  // allocate a fresh backing buffer the size of the whole frame (megabytes/sec of garbage at this
  // frame rate), which is what was actually behind the page-wide jank: a canvas draw call is
  // cheap, but the GC pauses from that churn block the main thread same as any other JS would.
  // Only reallocated on the rare frame where the segmenter's own output size actually changes.
  let maskImageData: ImageData | null = null;
  // Kicks off exactly once per (background, size) combo the first time it's needed — every later
  // frame hits the synchronous cache in getSceneCached instead of re-entering this promise chain.
  let pendingScene: BackgroundId | null = null;

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
      personCtx.drawImage(video, 0, 0, width, height);
      personCtx.globalCompositeOperation = "destination-in";
      personCtx.drawImage(maskCanvas, 0, 0, width, height);
      personCtx.globalCompositeOperation = "source-over";

      if (backgroundId === "blur") {
        outCtx.filter = "blur(14px)";
        outCtx.drawImage(video, 0, 0, width, height);
        outCtx.filter = "none";
        outCtx.drawImage(personCanvas, 0, 0);
        return;
      }
      const cachedScene = getSceneCached(backgroundId, width, height);
      if (cachedScene) {
        outCtx.drawImage(cachedScene, 0, 0);
        outCtx.drawImage(personCanvas, 0, 0);
        return;
      }
      // Not painted yet at this size — draw just the person for this one frame while it renders
      // in the background, rather than blocking every frame on a promise chain.
      outCtx.drawImage(personCanvas, 0, 0);
      if (pendingScene !== backgroundId) {
        pendingScene = backgroundId;
        getScene(backgroundId, width, height).then(() => {
          if (pendingScene === backgroundId) pendingScene = null;
        });
      }
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
