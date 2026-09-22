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
  | "crowd"
  | "caesarea"
  | "bar"
  | "fireplace"
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
  { id: "crowd", labelKey: "record.bg.crowd" },
  { id: "caesarea", labelKey: "record.bg.caesarea" },
  { id: "bar", labelKey: "record.bg.bar" },
  { id: "fireplace", labelKey: "record.bg.fireplace" },
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

/** A selfie held up in the middle of a packed crowd — hands and phone lights filling the frame,
 *  close and warm, rather than arena's distanced view of a crowd from the stage. */
function paintCrowd(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#140b1c");
  bg.addColorStop(0.5, "#251531");
  bg.addColorStop(1, "#08060c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.5, h * 0.05, w * 0.95, "#ffdca8", 0.32);
  glow(ctx, w * 0.14, h * 0.22, w * 0.5, brandColor("coral"), 0.18);
  glow(ctx, w * 0.88, h * 0.24, w * 0.5, brandColor("indigo"), 0.18);

  // Rows of heads packed close, getting bigger toward the bottom (closer to camera); every third
  // person has a raised arm topped with a small phone-light glow.
  const rows = 7;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const rowY = h * (0.4 + t * 0.62);
    const radius = w * (0.022 + t * 0.05);
    const count = Math.ceil(w / (radius * 2)) + 1;
    for (let i = 0; i < count; i++) {
      const jitter = ((i * 53 + r * 29) % 10) / 10 - 0.5;
      const x = i * radius * 2 + (r % 2 === 0 ? radius : 0) + jitter * radius * 0.6;
      const shade = `rgba(10,7,16,${0.5 + t * 0.42})`;
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.ellipse(x, rowY, radius * 0.72, radius * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      if ((i + r) % 3 === 0) {
        const armX = x + radius * 0.2;
        const armTopY = rowY - radius * 2.4;
        ctx.strokeStyle = shade;
        ctx.lineWidth = Math.max(1, radius * 0.3);
        ctx.beginPath();
        ctx.moveTo(x, rowY - radius * 0.5);
        ctx.lineTo(armX, armTopY);
        ctx.stroke();
        glow(ctx, armX, armTopY, radius * 3.2, "#fff4d6", 0.45 * (0.5 + t * 0.5));
      }
    }
  }
}

/** The Caesarea amphitheater: ancient stone tiers by the sea at dusk, flanked by tall light towers. */
function paintCaesarea(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.58);
  sky.addColorStop(0, "#251534");
  sky.addColorStop(0.55, "#7a3b52");
  sky.addColorStop(1, "#d9814f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.58);

  const sea = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.62);
  sea.addColorStop(0, "#d9814f");
  sea.addColorStop(1, "#11202c");
  ctx.fillStyle = sea;
  ctx.fillRect(0, h * 0.5, w, h * 0.13);

  // Curved stone tiers rising toward the back, narrowing in from the stage at the bottom.
  const tierRows = 6;
  for (let r = 0; r < tierRows; r++) {
    const t = r / (tierRows - 1);
    const y = h * (0.6 + t * 0.375);
    const rowH = h * 0.075;
    const inset = w * 0.16 * (1 - t);
    ctx.fillStyle = `rgb(${28 + r * 4}, ${21 + r * 3}, ${16 + r * 2})`;
    ctx.fillRect(inset, y, w - inset * 2, rowH);
  }

  // Two tall light towers flanking the stage, each throwing a warm lamp glow down over the crowd.
  for (const tx of [w * 0.09, w * 0.91]) {
    ctx.fillStyle = "#0b0908";
    ctx.fillRect(tx - w * 0.008, h * 0.14, w * 0.016, h * 0.48);
    glow(ctx, tx, h * 0.14, w * 0.3, "#ffe3ac", 0.5);
  }
  glow(ctx, w * 0.5, h * 0.58, w * 0.65, "#ffd9a0", 0.28);
}

/** An intimate bar: a warm pendant lamp over a back-bar shelf of bottles, everything else dim. */
function paintBar(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#1c130e");
  bg.addColorStop(1, "#090504");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.5, h * 0.1, w * 0.6, "#ffb35c", 0.4);

  const shelfY = h * 0.32;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, shelfY, w, h * 0.014);
  const bottleCount = 9;
  for (let i = 0; i < bottleCount; i++) {
    const bx = (i + 0.5) * (w / bottleCount);
    const bh = h * (0.07 + ((i * 37) % 5) * 0.012);
    const bw = w * 0.018;
    ctx.fillStyle = "rgba(18,12,9,0.92)";
    ctx.fillRect(bx - bw / 2, shelfY - bh, bw, bh);
    glow(ctx, bx, shelfY - bh, bw * 3.5, brandColor(i % 2 === 0 ? "gold" : "coral"), 0.1);
  }

  const barTop = ctx.createLinearGradient(0, h * 0.78, 0, h);
  barTop.addColorStop(0, "transparent");
  barTop.addColorStop(1, "#2b160c");
  ctx.fillStyle = barTop;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
}

/** A cozy living room with a lit fireplace: a stone hearth glowing warm against a dim room. */
function paintFireplace(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#2b1f16");
  bg.addColorStop(1, "#110b07");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const hearthW = w * 0.58;
  const hearthX = (w - hearthW) / 2;
  const hearthY = h * 0.62;
  const hearthH = h * 0.38;
  ctx.fillStyle = "#3c2d20";
  ctx.fillRect(hearthX - w * 0.03, hearthY - h * 0.02, hearthW + w * 0.06, hearthH + h * 0.02);
  ctx.fillStyle = "#0c0502";
  ctx.fillRect(hearthX, hearthY, hearthW, hearthH);

  glow(ctx, w * 0.5, hearthY + hearthH * 0.6, w * 0.5, "#ff8a3d", 0.55);
  glow(ctx, w * 0.5, hearthY + hearthH * 0.75, w * 0.28, "#ffd166", 0.5);
  glow(ctx, w * 0.5, h * 0.88, w * 0.9, "#ff7a3d", 0.18);
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
  if (id === "crowd") return paintCrowd(ctx, w, h);
  if (id === "caesarea") return paintCaesarea(ctx, w, h);
  if (id === "bar") return paintBar(ctx, w, h);
  if (id === "fireplace") return paintFireplace(ctx, w, h);
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
