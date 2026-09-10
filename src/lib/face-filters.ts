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

export type FilterKind = "partyhat" | "sunglasses" | "mask" | "catears" | "bunnyears";

// How long a triggered filter stays on screen, pop-in + hold + fade-out included — a "gift
// moment," not something you'd want to sit through a whole take wearing.
export const FILTER_DURATION_MS = 4500;
const POP_IN_MS = 350;
const FADE_OUT_MS = 500;

// Standard MediaPipe face-mesh landmark indices (the same 468/478-point topology across every
// MediaPipe face model) used to anchor each graphic:
const FOREHEAD_TOP = 10;
const EYE_OUTER_RIGHT = 33; // subject's right eye, outer corner
const EYE_OUTER_LEFT = 263; // subject's left eye, outer corner
const CHEEK_RIGHT = 234;
const CHEEK_LEFT = 454;

function dist(a: NormalizedLandmark, b: NormalizedLandmark, w: number, h: number) {
  return Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
}

// Every filter bitmap is drawn on a UNIT x UNIT canvas with its own fixed anchor point and
// reference width, so the same per-frame transform math (translate to anchor, rotate, scale by
// measured/reference) works for all of them regardless of shape.
const UNIT = 300;

type FilterSpec = {
  /** Where on the face this filter anchors — forehead (hats/ears) or the eye line (glasses/mask). */
  anchor: "forehead" | "eyes";
  /** Point within the UNIT x UNIT bitmap that lands exactly on the anchor after transform. */
  bitmapAnchor: { x: number; y: number };
  /** Width (in bitmap units) that should map to the measured reference (face or eye) width. */
  referenceWidth: number;
  paint: (ctx: CanvasRenderingContext2D) => void;
};

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

const FILTER_SPECS: Record<FilterKind, FilterSpec> = {
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
};

const bitmapCache = new Map<FilterKind, ImageBitmap>();
async function getFilterBitmap(kind: FilterKind): Promise<ImageBitmap> {
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

let landmarkerPromise: Promise<FaceLandmarker> | null = null;
function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = import("@mediapipe/tasks-vision").then(
      async ({ FilesetResolver, FaceLandmarker }) => {
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const options = {
          runningMode: "VIDEO" as const,
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        };
        try {
          return await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "GPU" },
            ...options,
          });
        } catch {
          return FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "CPU" },
            ...options,
          });
        }
      },
    );
  }
  return landmarkerPromise;
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
  const [landmarker, bitmap] = await Promise.all([loadFaceLandmarker(), getFilterBitmap(kind)]);
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

    const result = landmarker.detectForVideo(video, Math.round(now));
    const face = result.faceLandmarks?.[0];
    if (!face) return;

    const vw = video.videoWidth || boxW;
    const vh = video.videoHeight || boxH;
    // object-cover mapping from the video's native pixel space to its rendered CSS box.
    const coverScale = Math.max(boxW / vw, boxH / vh);
    const offsetX = (vw * coverScale - boxW) / 2;
    const offsetY = (vh * coverScale - boxH) / 2;
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
    const anchorPoint =
      spec.anchor === "eyes"
        ? toBox({ x: (eyeR.x + eyeL.x) / 2, y: (eyeR.y + eyeL.y) / 2 } as NormalizedLandmark)
        : toBox(face[FOREHEAD_TOP]);

    const scale = measured / spec.referenceWidth;
    const { scale: envScale, alpha } = envelope(elapsed, FILTER_DURATION_MS);

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
