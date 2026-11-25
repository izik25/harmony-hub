/**
 * Face-tracked filter effects (party hat, sunglasses, ...) — the "gift" counterpart to
 * virtual-background.ts's persistent scenes. These are deliberately transient: triggered by
 * spending coins (buying one for yourself on /record, or being sent one as a gift — see
 * buyFilterForSelf/sendGift in functions/wallet.ts), they pop onto your face for a few seconds and
 * fade back out, the same way a gift animation flashes on screen rather than becoming a
 * permanent wearable. Nothing here is ever baked into a recorded take — this only ever draws over
 * the live preview element, purely a client-side show effect.
 *
 * Uses MediaPipe's Face Landmarker (same @mediapipe/tasks-vision package and self-hosting
 * approach as virtual-background.ts's selfie segmenter — dynamic import, WASM/model served from
 * this app's own /mediapipe and /models rather than a third-party CDN) to find face position,
 * scale and tilt each frame, then transforms a pre-drawn 2D graphic to match.
 */
import type { FaceLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";

export type FilterKind =
  "partyhat" | "sunglasses" | "mask" | "catears" | "bunnyears" | "mic" | "crown";

// How long a triggered filter stays on screen, pop-in + hold + fade-out included — a "gift
// moment," not something you'd want to sit through a whole take wearing.
export const FILTER_DURATION_MS = 4500;
const POP_IN_MS = 350;
const FADE_OUT_MS = 500;

// Standard MediaPipe face-mesh landmark indices (the same 468/478-point topology across every
// MediaPipe face model) used to anchor each graphic. Exported so camera-effects.ts's persistent
// (recorded, non-gift) overlay pass can reuse the exact same anchoring math below.
export const FOREHEAD_TOP = 10;
export const CHIN_BOTTOM = 152;
export const EYE_OUTER_RIGHT = 33; // subject's right eye, outer corner
export const EYE_OUTER_LEFT = 263; // subject's left eye, outer corner
export const CHEEK_RIGHT = 234;
export const CHEEK_LEFT = 454;

export function dist(a: NormalizedLandmark, b: NormalizedLandmark, w: number, h: number) {
  return Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
}

// Every filter bitmap is drawn on a UNIT x UNIT canvas with its own fixed anchor point and
// reference width, so the same per-frame transform math (translate to anchor, rotate, scale by
// measured/reference) works for all of them regardless of shape.
const UNIT = 300;

export type FilterSpec = {
  /** Where on the face this filter anchors — forehead (hats/ears/crown), chin (mic) or the eye line (glasses/mask). */
  anchor: "forehead" | "chin" | "eyes";
  /** Point within the UNIT x UNIT bitmap that lands exactly on the anchor after transform. */
  bitmapAnchor: { x: number; y: number };
  /** Width (in bitmap units) that should map to the measured reference (face or eye) width. */
  referenceWidth: number;
  paint: (ctx: CanvasRenderingContext2D) => void;
};

/**
 * Shared per-frame transform math: where a filter's bitmap anchor should land, how much it should
 * rotate, and how much it should scale, given one frame's face landmarks. Used both by the
 * transient gift player below (which maps into a CSS-scaled preview box via coverScale/offset) and
 * by camera-effects.ts's persistent overlay pass (which draws 1:1 onto a canvas sized exactly to
 * the video's native resolution, so it just passes coverScale 1 and offset 0).
 */
export function computeFaceAnchor(
  spec: FilterSpec,
  face: NormalizedLandmark[],
  vw: number,
  vh: number,
  coverScale: number,
  offsetX: number,
  offsetY: number,
): { point: { x: number; y: number }; angle: number; scale: number } {
  const toBox = (p: NormalizedLandmark) => ({
    x: p.x * vw * coverScale - offsetX,
    y: p.y * vh * coverScale - offsetY,
  });
  const eyeR = face[EYE_OUTER_RIGHT];
  const eyeL = face[EYE_OUTER_LEFT];
  const angle = Math.atan2((eyeL.y - eyeR.y) * vh, (eyeL.x - eyeR.x) * vw);
  const measured =
    spec.anchor === "eyes"
      ? dist(eyeR, eyeL, vw, vh) * coverScale
      : dist(face[CHEEK_RIGHT], face[CHEEK_LEFT], vw, vh) * coverScale;
  const anchorLandmark =
    spec.anchor === "eyes"
      ? ({ x: (eyeR.x + eyeL.x) / 2, y: (eyeR.y + eyeL.y) / 2 } as NormalizedLandmark)
      : spec.anchor === "chin"
        ? face[CHIN_BOTTOM]
        : face[FOREHEAD_TOP];
  return { point: toBox(anchorLandmark), angle, scale: measured / spec.referenceWidth };
}

function paintPartyHat(ctx: CanvasRenderingContext2D) {
  // A conical party hat sitting on the forehead, base centered at (150,300), tip near the top.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(70, 300);
  ctx.lineTo(230, 300);
  ctx.lineTo(150, 20);
  ctx.closePath();
  ctx.clip();
  const stripeColors = ["#ff6b57", "#ffd166", "#5b8a91", "#ff6b57", "#ffd166"];
  for (let i = 0; i < stripeColors.length; i++) {
    ctx.fillStyle = stripeColors[i];
    ctx.fillRect(70 + i * 32, 0, 32, 300);
  }
  ctx.restore();
  // Rim ellipse at the base + a pompom at the tip finish the silhouette.
  ctx.beginPath();
  ctx.ellipse(150, 300, 80, 16, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#f5f0e6";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(150, 20, 22, 0, Math.PI * 2);
  ctx.fillStyle = "#f5f0e6";
  ctx.fill();
}

function paintSunglasses(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#14161a";
  const lensY = 150;
  [95, 205].forEach((cx) => {
    ctx.beginPath();
    ctx.ellipse(cx, lensY, 62, 46, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillRect(133, lensY - 10, 34, 16);
  // A soft diagonal highlight on each lens sells "glossy lens" rather than a flat dark oval.
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  [95, 205].forEach((cx) => {
    ctx.beginPath();
    ctx.ellipse(cx - 18, lensY - 14, 18, 9, -0.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function paintMask(ctx: CanvasRenderingContext2D) {
  // A masquerade-style mask across both eyes, with upswept outer corners.
  ctx.fillStyle = "#2f2b5e";
  ctx.beginPath();
  ctx.moveTo(20, 165);
  ctx.quadraticCurveTo(60, 90, 150, 110);
  ctx.quadraticCurveTo(240, 90, 280, 165);
  ctx.quadraticCurveTo(240, 190, 150, 175);
  ctx.quadraticCurveTo(60, 190, 20, 165);
  ctx.closePath();
  ctx.fill();
  // Upswept flourishes at the outer corners.
  ctx.beginPath();
  ctx.moveTo(20, 165);
  ctx.quadraticCurveTo(0, 110, 35, 90);
  ctx.quadraticCurveTo(45, 120, 30, 155);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(280, 165);
  ctx.quadraticCurveTo(300, 110, 265, 90);
  ctx.quadraticCurveTo(255, 120, 270, 155);
  ctx.closePath();
  ctx.fill();
  // Eye cutouts.
  ctx.globalCompositeOperation = "destination-out";
  [95, 205].forEach((cx) => {
    ctx.beginPath();
    ctx.ellipse(cx, 145, 38, 26, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalCompositeOperation = "source-over";
  // A scatter of gold sparkle dots for a bit of masquerade sparkle.
  ctx.fillStyle = "#e8b84f";
  const dots: [number, number, number][] = [
    [55, 120, 4],
    [80, 100, 3],
    [220, 100, 3],
    [245, 120, 4],
    [150, 95, 3],
  ];
  for (const [x, y, r] of dots) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function earShape(ctx: CanvasRenderingContext2D, cx: number, outer: string, inner: string) {
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.moveTo(cx - 35, 300);
  ctx.quadraticCurveTo(cx - 45, 190, cx, 130);
  ctx.quadraticCurveTo(cx + 45, 190, cx + 35, 300);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.moveTo(cx - 20, 280);
  ctx.quadraticCurveTo(cx - 26, 205, cx, 165);
  ctx.quadraticCurveTo(cx + 26, 205, cx + 20, 280);
  ctx.closePath();
  ctx.fill();
}

function paintCatEars(ctx: CanvasRenderingContext2D) {
  earShape(ctx, 90, "#2a2e37", "#ff9fb0");
  earShape(ctx, 210, "#2a2e37", "#ff9fb0");
}

function paintBunnyEars(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#f5f0e6";
  [90, 210].forEach((cx) => {
    ctx.beginPath();
    ctx.ellipse(cx, 155, 30, 150, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#ff9fb0";
  [90, 210].forEach((cx) => {
    ctx.beginPath();
    ctx.ellipse(cx, 165, 15, 120, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function paintMic(ctx: CanvasRenderingContext2D) {
  // A handheld mic held up near the chin/mouth — head at the top (anchored just under the chin),
  // handle running down and slightly off-center like it's tilted in a hand just out of frame.
  ctx.save();
  ctx.translate(150, 60);
  ctx.rotate(-0.18);
  // Handle.
  ctx.fillStyle = "#20222a";
  ctx.fillRect(-14, 40, 28, 220);
  // Mic head (capsule).
  ctx.fillStyle = "#3a3d47";
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 46, 0, 0, Math.PI * 2);
  ctx.fill();
  // A basket-mesh ring plus a few grille lines sell "microphone" rather than a plain lightbulb.
  ctx.strokeStyle = "#0e0f13";
  ctx.lineWidth = 3;
  for (let i = -20; i <= 20; i += 10) {
    ctx.beginPath();
    ctx.moveTo(-30, i);
    ctx.lineTo(30, i);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 46, 0, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#14161a";
  ctx.stroke();
  // Silver collar between head and handle.
  ctx.fillStyle = "#cfd3da";
  ctx.fillRect(-16, 34, 32, 12);
  ctx.restore();
}

function paintCrown(ctx: CanvasRenderingContext2D) {
  // A jeweled pop-star/diva crown sitting on the forehead — gold points + a gem on each tip.
  ctx.save();
  ctx.fillStyle = "#f2c94c";
  ctx.beginPath();
  ctx.moveTo(60, 300);
  ctx.lineTo(60, 190);
  ctx.lineTo(105, 245);
  ctx.lineTo(150, 160);
  ctx.lineTo(195, 245);
  ctx.lineTo(240, 190);
  ctx.lineTo(240, 300);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#b8860b";
  ctx.lineWidth = 4;
  ctx.stroke();
  // Base band.
  ctx.fillStyle = "#e8b84f";
  ctx.fillRect(58, 290, 184, 26);
  // Gems: a large one centered on the tallest point, smaller ones on the side points.
  const gems: [number, number, number, string][] = [
    [150, 175, 12, "#ff5b7a"],
    [60, 205, 8, "#5bc8ff"],
    [240, 205, 8, "#5bc8ff"],
  ];
  for (const [x, y, r, color] of gems) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export const FILTER_SPECS: Record<FilterKind, FilterSpec> = {
  partyhat: {
    anchor: "forehead",
    bitmapAnchor: { x: 150, y: 300 },
    referenceWidth: 160,
    paint: paintPartyHat,
  },
  catears: {
    anchor: "forehead",
    bitmapAnchor: { x: 150, y: 300 },
    referenceWidth: 220,
    paint: paintCatEars,
  },
  bunnyears: {
    anchor: "forehead",
    bitmapAnchor: { x: 150, y: 300 },
    referenceWidth: 220,
    paint: paintBunnyEars,
  },
  sunglasses: {
    anchor: "eyes",
    bitmapAnchor: { x: 150, y: 150 },
    referenceWidth: 190,
    paint: paintSunglasses,
  },
  mask: {
    anchor: "eyes",
    bitmapAnchor: { x: 150, y: 150 },
    referenceWidth: 220,
    paint: paintMask,
  },
  mic: {
    anchor: "chin",
    bitmapAnchor: { x: 150, y: 20 },
    referenceWidth: 130,
    paint: paintMic,
  },
  crown: {
    anchor: "forehead",
    bitmapAnchor: { x: 150, y: 300 },
    referenceWidth: 200,
    paint: paintCrown,
  },
};

const bitmapCache = new Map<FilterKind, ImageBitmap>();
export async function getFilterBitmap(kind: FilterKind): Promise<ImageBitmap> {
  const cached = bitmapCache.get(kind);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = UNIT;
  canvas.height = UNIT;
  const ctx = canvas.getContext("2d")!;
  FILTER_SPECS[kind].paint(ctx);
  const bitmap = await createImageBitmap(canvas);
  bitmapCache.set(kind, bitmap);
  return bitmap;
}

type Delegate = "GPU" | "CPU";

// What the face tracker is doing right now, for the ?fxdebug readout on /record (FaceFxDebug in
// FaceFilterOverlay.tsx) — the one way to see on a real phone why a prop isn't showing.
export const faceFxDebug = {
  delegate: "-" as Delegate | "-",
  status: "idle",
  detections: 0,
  faces: 0,
  errors: 0,
  lastError: "",
};

// The GPU delegate is the fast path and works on desktop, but Android GPUs fail it in two ways:
// silently returning no faces at all, or detecting fine for a second or two and then throwing a
// GPU-side graph error that never clears. So the GPU is dropped — every tracker moves to the CPU
// delegate for the rest of the visit — the moment it fails to load or throws, or if it runs for a
// while without ever finding a face. Once it has found a face, later misses alone just mean
// nobody's in frame.
let gpuTrusted = false;
let gpuRejected = false;

const landmarkerPromises: Partial<Record<Delegate, Promise<FaceLandmarker>>> = {};
const loadedLandmarkers: Partial<Record<Delegate, FaceLandmarker>> = {};
function loadLandmarker(delegate: Delegate): Promise<FaceLandmarker> {
  let promise = landmarkerPromises[delegate];
  if (!promise) {
    faceFxDebug.status = `loading ${delegate}`;
    promise = import("@mediapipe/tasks-vision")
      .then(async ({ FilesetResolver, FaceLandmarker }) => {
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
        loadedLandmarkers[delegate] = landmarker;
        return landmarker;
      })
      .catch((err) => {
        // Not cached as a failure: a later attempt (or the CPU fallback) gets a fresh try.
        delete landmarkerPromises[delegate];
        faceFxDebug.lastError = `load ${delegate}: ${err instanceof Error ? err.message : err}`;
        throw err;
      });
    landmarkerPromises[delegate] = promise;
  }
  return promise;
}

/** Forgets (and frees) an instance whose graph has failed, so the next load builds a new one.
 * Only if it's still the cached one: a second tracker reporting the same failure late mustn't
 * throw away the replacement the first one already loaded. */
function discardLandmarker(delegate: Delegate, landmarker: FaceLandmarker | null) {
  if (!landmarker || loadedLandmarkers[delegate] !== landmarker) return;
  delete loadedLandmarkers[delegate];
  delete landmarkerPromises[delegate];
  try {
    landmarker.close();
  } catch {
    // Already torn down along with its failed graph.
  }
}

/** Whichever landmarker trackers should use now — GPU until it's been ruled out, else CPU. */
export async function loadFaceLandmarker(): Promise<{
  landmarker: FaceLandmarker;
  delegate: Delegate;
}> {
  if (!gpuRejected) {
    try {
      return { landmarker: await loadLandmarker("GPU"), delegate: "GPU" };
    } catch {
      gpuRejected = true;
    }
  }
  return { landmarker: await loadLandmarker("CPU"), delegate: "CPU" };
}

// Every landmarker is a VIDEO-mode graph, and MediaPipe requires every frame it's handed to carry
// a strictly later timestamp than the last — a repeat doesn't just fail that one call, it leaves
// the graph permanently in error ("Graph has errors") until a full reload. Two loops feed it at
// once whenever a gift filter plays while a prop is pinned (playFaceFilter + camera-effects.ts),
// and both get the same requestAnimationFrame time, so every call goes through this one shared
// clock that always moves forward.
let lastDetectTs = -1;
function detectFaceLandmarks(landmarker: FaceLandmarker, video: HTMLVideoElement) {
  const ts = Math.max(lastDetectTs + 1, Math.round(performance.now()));
  lastDetectTs = ts;
  return landmarker.detectForVideo(video, ts);
}

// Detection runs ~15 times a second rather than every display frame (60-120Hz on a phone), and
// the last face found is held briefly in between — drawing still happens every frame, so a prop
// moves smoothly while costing a fraction of the CPU (which matters once on the CPU delegate).
const DETECT_INTERVAL_MS = 66;
const HOLD_MS = 400;
// ~1.5s of GPU detections without a single face before it's ruled out (see gpuTrusted above).
const GPU_TRIAL_MISSES = 24;

export interface FaceTracker {
  /**
   * The face to draw on this frame, or null. Call once per drawn frame. `intervalMs` overrides
   * how often a fresh detection runs — makeup-style looks (beauty-effects.ts) ask for a tighter
   * one than props, since tinted lips trailing the mouth shows far more than a hat trailing it.
   */
  track(video: HTMLVideoElement, now: number, intervalMs?: number): NormalizedLandmark[] | null;
}

export function createFaceTracker(): FaceTracker {
  let landmarker: FaceLandmarker | null = null;
  let delegate: Delegate | null = null;
  let loading = false;
  let retryAt = 0;
  let misses = 0;
  let lastDetectAt = -Infinity;
  let lastFace: NormalizedLandmark[] | null = null;
  let lastFaceAt = -Infinity;

  const load = (now: number) => {
    if (loading || now < retryAt) return;
    loading = true;
    loadFaceLandmarker()
      .then((r) => {
        landmarker = r.landmarker;
        delegate = r.delegate;
        misses = 0;
        faceFxDebug.delegate = r.delegate;
        faceFxDebug.status = "ready";
      })
      .catch(() => {
        retryAt = performance.now() + 3000;
        faceFxDebug.status = "load failed";
      })
      .finally(() => {
        loading = false;
      });
  };

  return {
    track(video, now, intervalMs = DETECT_INTERVAL_MS) {
      // Another tracker already ruled the GPU out — follow it rather than repeat the trial.
      if (delegate === "GPU" && gpuRejected) landmarker = null;
      if (!landmarker) {
        load(now);
        return null;
      }
      if (video.readyState >= 2 && now - lastDetectAt >= intervalMs) {
        lastDetectAt = now;
        let face: NormalizedLandmark[] | null = null;
        try {
          face = detectFaceLandmarks(landmarker, video).faceLandmarks?.[0] ?? null;
          faceFxDebug.detections++;
        } catch (err) {
          faceFxDebug.errors++;
          faceFxDebug.lastError = `detect ${delegate}: ${err instanceof Error ? err.message : err}`;
          // A graph that has thrown stays in error for good, so it's dropped on the spot. A
          // GPU failure rules the GPU out (seen on Samsung: ~1.5s of good detections, then a
          // GPU-side "Calculator::Process" failure); a CPU one gets a fresh instance shortly.
          const broken = landmarker;
          const brokenDelegate = delegate ?? "CPU";
          landmarker = null;
          discardLandmarker(brokenDelegate, broken);
          if (brokenDelegate === "GPU") {
            gpuRejected = true;
            faceFxDebug.status = "GPU failed, switching to CPU";
          } else {
            retryAt = now + 1000;
            faceFxDebug.status = "CPU failed, reloading";
          }
          return now - lastFaceAt <= HOLD_MS ? lastFace : null;
        }
        if (face) {
          lastFace = face;
          lastFaceAt = now;
          misses = 0;
          faceFxDebug.faces++;
          if (delegate === "GPU") gpuTrusted = true;
        } else if (++misses >= GPU_TRIAL_MISSES && delegate === "GPU" && !gpuTrusted) {
          gpuRejected = true;
          landmarker = null;
          faceFxDebug.status = "GPU found no face, switching to CPU";
        }
      }
      return now - lastFaceAt <= HOLD_MS ? lastFace : null;
    },
  };
}

// Ease-out-back style overshoot on the way in (lands slightly big, settles to 1) and a plain
// ease-in fade on the way out — reads as a small "pop" rather than a flat linear scale.
function envelope(elapsedMs: number, totalMs: number): { scale: number; alpha: number } {
  if (elapsedMs < POP_IN_MS) {
    const t = elapsedMs / POP_IN_MS;
    const overshoot = 1.7;
    const scale = 1 + (overshoot - 1) * Math.sin(t * Math.PI * 0.5) * (1 - t) + t;
    return { scale: Math.min(scale, overshoot), alpha: t };
  }
  const fadeStart = totalMs - FADE_OUT_MS;
  if (elapsedMs > fadeStart) {
    const t = Math.max(0, (totalMs - elapsedMs) / FADE_OUT_MS);
    return { scale: 1, alpha: t };
  }
  return { scale: 1, alpha: 1 };
}

export interface FaceFilterPlayer {
  stop(): void;
}

/**
 * Runs face tracking against `video` and draws `kind`, transformed to match, into `canvas` for
 * FILTER_DURATION_MS. `canvas` is expected to already be sized/positioned to exactly overlay
 * `video`'s rendered box (see FaceFilterOverlay.tsx) — this only ever draws in that box's own CSS
 * pixel coordinate space (canvas width/height already accounts for devicePixelRatio). Calls
 * `onDone` once the effect finishes on its own; `stop()` cancels it early (e.g. on unmount)
 * without calling onDone, since the caller already knows in that case.
 */
export async function playFaceFilter(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  kind: FilterKind,
  onDone: () => void,
): Promise<FaceFilterPlayer> {
  // Waits for the model (and the 3D props, props-3d.ts) before the clock starts, so a slow first
  // load doesn't eat the effect. No WebGL → the 2D sticker below.
  const [, bitmap, props3d] = await Promise.all([
    loadFaceLandmarker(),
    getFilterBitmap(kind),
    import("./props-3d").then((m) => m.getProps3DRenderer()).catch(() => null),
  ]);
  const tracker = createFaceTracker();
  const spec = FILTER_SPECS[kind];
  const ctx = canvas.getContext("2d")!;

  let running = true;
  let raf = 0;
  const startedAt = performance.now();

  const drawFrame = (now: number) => {
    if (!running) return;
    const elapsed = now - startedAt;
    if (elapsed >= FILTER_DURATION_MS) {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      onDone();
      return;
    }
    raf = requestAnimationFrame(drawFrame);

    const dpr = window.devicePixelRatio || 1;
    const boxW = canvas.width / dpr;
    const boxH = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boxW, boxH);
    if (video.readyState < 2) return;

    const face = tracker.track(video, now);
    if (!face) return;

    const vw = video.videoWidth || boxW;
    const vh = video.videoHeight || boxH;
    // object-cover mapping from the video's native pixel space to its rendered CSS box.
    const coverScale = Math.max(boxW / vw, boxH / vh);
    const offsetX = (vw * coverScale - boxW) / 2;
    const offsetY = (vh * coverScale - boxH) / 2;
    const { scale: envScale, alpha } = envelope(elapsed, FILTER_DURATION_MS);

    // The 3D prop is rendered at the video's own resolution, then laid over the preview box with
    // the same object-cover mapping the video itself gets.
    const frame3d = props3d?.render(face, kind, vw, vh, envScale);
    if (frame3d) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(frame3d, -offsetX, -offsetY, vw * coverScale, vh * coverScale);
      ctx.restore();
      return;
    }

    const {
      point: anchorPoint,
      angle,
      scale,
    } = computeFaceAnchor(spec, face, vw, vh, coverScale, offsetX, offsetY);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(anchorPoint.x, anchorPoint.y);
    ctx.rotate(angle);
    ctx.scale(scale * envScale, scale * envScale);
    ctx.drawImage(bitmap, -spec.bitmapAnchor.x, -spec.bitmapAnchor.y);
    ctx.restore();
  };
  raf = requestAnimationFrame(drawFrame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
