/**
 * Face-aware "beauty" looks for the selfie camera — the part of a look that a whole-frame CSS
 * grade (video-filters.ts) can't do on its own: Photoshop-style retouching, freckles, eye color,
 * blush, lip color, glam makeup and glass skin, all anchored to the face MediaPipe's landmarker
 * finds each frame.
 *
 * Runs inside camera-effects.ts's draw loop, right after the frame is drawn through the look's
 * grade, so — exactly like the grade and the overlay props — whatever it paints is baked into the
 * recorded take, not just the preview.
 *
 * Realism rules every effect here follows:
 *  - Work WITH the real pixels (blend modes that keep the skin's own light, texture and
 *    highlights) rather than painting flat color over them.
 *  - Feather every edge; nothing real has a hard cut-off.
 *  - Hold still: landmarks are smoothed (createLandmarkSmoother) so makeup sits on the skin
 *    instead of shimmering on top of it.
 *
 * Everything is plain 2D-canvas work (paths, gradients, blend modes and `ctx.filter` blurs on
 * reduced-resolution copies), no WebGL, so it runs on the same phones the rest of the camera
 * pipeline already does.
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type IrisColor = "blue" | "green" | "hazel";

export type BeautyRecipe = {
  /** Retouch strength, 0..1 — evens skin (lifts pores/blemishes/fine lines), keeps texture. */
  smooth?: number;
  /** Retoucher's dodge & burn: light on the high planes, soft shade under the cheekbones, 0..1. */
  sculpt?: number;
  /** Glass-skin dewy highlights on cheekbones, nose bridge, forehead, cupid's bow, 0..1. */
  dewy?: number;
  /** Soft studio glow (blurred copy screened over the frame), 0..1. */
  glow?: number;
  /** Darkened corners, 0..1. */
  vignette?: number;
  /** Brighten the whites of the eyes a touch, 0..1. */
  eyePop?: number;
  /** Brighten the under-eye (concealer), 0..1. */
  underEye?: number;
  /** Whiten teeth, 0..1. */
  teeth?: number;
  freckles?: boolean;
  /** Rosy cheeks + a sun-kissed swipe over the nose, 0..1. */
  blush?: number;
  /** Lip color, as "r,g,b". */
  lips?: string;
  /** Natural-looking iris recolor. */
  eyes?: IrisColor;
  /** Winged eyeliner, 0..1. */
  liner?: number;
  /** Eyeshadow color, as "r,g,b". */
  shadow?: string;
};

/** Whether a recipe needs face landmarks at all (glow/vignette alone don't). */
export function recipeNeedsFace(r: BeautyRecipe | undefined): boolean {
  return (
    !!r &&
    !!(
      r.smooth ||
      r.sculpt ||
      r.dewy ||
      r.eyePop ||
      r.underEye ||
      r.teeth ||
      r.freckles ||
      r.blush ||
      r.lips ||
      r.eyes ||
      r.liner ||
      r.shadow
    )
  );
}

// Standard MediaPipe face-mesh rings (same topology as face-filters.ts's anchor indices).
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
  176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
// Each eye ring starts at the outer corner, runs along the upper lid to the inner corner (the
// first 9 points), then back along the lower lid.
const RIGHT_EYE = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const LEFT_EYE = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
const RIGHT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const LEFT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
// Lower edge of each brow, inner end to outer end.
const RIGHT_BROW_LOW = [55, 65, 52, 53, 46];
const LEFT_BROW_LOW = [285, 295, 282, 283, 276];
const LIPS_OUTER = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
];
const LIPS_INNER = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
];
// Iris center + four rim points per eye (only present on the 478-point model output).
const IRISES: [number, number[]][] = [
  [468, [469, 470, 471, 472]],
  [473, [474, 475, 476, 477]],
];
const NOSE_TIP = 1;
const SUBNASALE = 2;
const FOREHEAD = 10;
const CHIN = 152;
const UPPER_LIP_TOP = 0;
const EYE_OUTER_R = 33;
const EYE_OUTER_L = 263;
const EYE_INNER_R = 133;
const EYE_INNER_L = 362;
const MOUTH_R = 61;
const MOUTH_L = 291;
const CHEEK_R = 234;
const CHEEK_L = 454;
const LOWER_LIP_INNER = 14;
const LOWER_LIP_OUTER = 17;

type Pt = { x: number; y: number };
const lerp = (p: Pt, q: Pt, t: number): Pt => ({
  x: p.x + (q.x - p.x) * t,
  y: p.y + (q.y - p.y) * t,
});

// Small seeded PRNG so procedural details (freckles, iris fibers) are identical every take.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Landmark stabilizer. Raw landmarks jitter by a pixel or two between detections even on a
 * perfectly still face, which makes anything drawn on them shimmer — the single biggest "this is
 * a filter" tell. This chases the latest detection every drawn frame with an adaptive rate: slow
 * (heavily smoothed) when the face is still, near-instant when it actually moves, so it removes
 * jitter without making makeup trail behind a turning head. It also interpolates between the
 * ~25Hz detections, so motion is smooth at the full display frame rate.
 */
export function createLandmarkSmoother(width: number, height: number) {
  let sm: { x: number; y: number; z: number }[] | null = null;
  let lastT = 0;
  const probes = [NOSE_TIP, EYE_OUTER_R, EYE_OUTER_L, MOUTH_R, MOUTH_L, CHIN, FOREHEAD];
  return (face: NormalizedLandmark[] | null, now: number): NormalizedLandmark[] | null => {
    if (!face) {
      sm = null;
      return null;
    }
    const dt = Math.min(4, Math.max(0.5, (now - lastT) / 16.7));
    lastT = now;
    if (!sm || sm.length !== face.length) {
      sm = face.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      return sm as NormalizedLandmark[];
    }
    const D =
      Math.hypot(
        (face[EYE_OUTER_L].x - face[EYE_OUTER_R].x) * width,
        (face[EYE_OUTER_L].y - face[EYE_OUTER_R].y) * height,
      ) || 1;
    let disp = 0;
    for (const i of probes) {
      disp += Math.hypot((face[i].x - sm[i].x) * width, (face[i].y - sm[i].y) * height);
    }
    disp /= probes.length * D;
    const perFrame = Math.min(1, 0.2 + disp * 7);
    const a = 1 - (1 - perFrame) ** dt;
    for (let i = 0; i < face.length; i++) {
      const s = sm[i];
      const p = face[i];
      s.x += (p.x - s.x) * a;
      s.y += (p.y - s.y) * a;
      s.z += (p.z - s.z) * a;
    }
    return sm as NormalizedLandmark[];
  };
}

/**
 * Freckle pattern in a face-local frame: x along the eye line, y down the face, both in units of
 * the outer-eye-corner distance, origin at the midpoint between the outer corners. The band
 * covers the nose bridge and upper cheeks — where real sun freckles cluster — and skips the eyes
 * and nostrils. Each freckle is two overlapping blobs of slightly different tone, since real
 * freckles are irregular, not round dots.
 */
type FreckleSpec = {
  lx: number;
  ly: number;
  r: number;
  a: number;
  tone: number;
  dx: number;
  dy: number;
  r2: number;
};
const FRECKLE_TEMPLATE: FreckleSpec[] = (() => {
  const rnd = mulberry32(2611);
  const out: FreckleSpec[] = [];
  let guard = 0;
  while (out.length < 140 && guard++ < 6000) {
    const lx = (rnd() * 2 - 1) * 0.62;
    const ly = 0.1 + rnd() * 0.38;
    const inBand = (lx / 0.6) ** 2 + ((ly - 0.28) / 0.17) ** 2 <= 1;
    if (!inBand || ly < 0.14) continue;
    if (ly > 0.4 && Math.abs(lx) < 0.15) continue; // nostrils
    // Densest over the bridge and the cheek apples, thinning toward the outer cheeks.
    const ax = Math.abs(lx);
    const w = Math.max(ax < 0.11 ? 0.9 : 0, Math.exp(-((ax - 0.29) ** 2) / 0.016), 0.22);
    if (rnd() > w) continue;
    const s = rnd();
    const r = 0.0032 + s * s * 0.0075;
    out.push({
      lx,
      ly,
      r,
      a: 0.16 + rnd() * 0.3,
      tone: Math.floor(rnd() * 3),
      dx: (rnd() - 0.5) * r * 1.4,
      dy: (rnd() - 0.5) * r * 1.4,
      r2: r * (0.45 + rnd() * 0.5),
    });
  }
  return out;
})();
const FRECKLE_TONES = ["150,92,60", "128,76,52", "170,110,72"];

/**
 * Iris palettes: a lighter "collarette" ring around the pupil, the main iris color, and the dark
 * limbal ring at the rim. Real eyes are never one flat color — the inner/outer contrast is most
 * of what makes a recolored iris read as an eye instead of a colored disc.
 */
const IRIS_PALETTES: Record<IrisColor, { inner: string; base: string; rim: string }> = {
  blue: { inner: "150,168,180", base: "84,120,158", rim: "26,38,58" },
  green: { inner: "168,142,74", base: "86,120,78", rim: "30,46,32" },
  hazel: { inner: "190,146,72", base: "140,98,50", rim: "56,38,22" },
};

const irisCache = new Map<IrisColor, HTMLCanvasElement>();
/** Procedural iris texture: radial fibers, crypts, collarette, limbal ring, open pupil. */
function irisTexture(color: IrisColor): HTMLCanvasElement {
  const cached = irisCache.get(color);
  if (cached) return cached;
  const N = 256;
  const R = N / 2;
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const x = c.getContext("2d")!;
  const pal = IRIS_PALETTES[color];
  const rnd = mulberry32(color === "blue" ? 11 : color === "green" ? 23 : 37);
  x.translate(R, R);

  const base = x.createRadialGradient(0, 0, 0, 0, 0, R);
  base.addColorStop(0, `rgb(${pal.inner})`);
  base.addColorStop(0.3, `rgb(${pal.inner})`);
  base.addColorStop(0.46, `rgb(${pal.base})`);
  base.addColorStop(0.8, `rgb(${pal.base})`);
  base.addColorStop(0.93, `rgb(${pal.rim})`);
  base.addColorStop(1, `rgb(${pal.rim})`);
  x.fillStyle = base;
  x.beginPath();
  x.arc(0, 0, R, 0, Math.PI * 2);
  x.fill();

  // Radial fibers (stroma): many thin light and dark streaks from the pupil outward.
  x.lineCap = "round";
  for (let i = 0; i < 420; i++) {
    const ang = rnd() * Math.PI * 2;
    const r0 = R * (0.26 + rnd() * 0.12);
    const r1 = R * (0.5 + rnd() * 0.42);
    const wob = (rnd() - 0.5) * 0.12;
    const light = rnd() < 0.6;
    x.strokeStyle = light
      ? `rgba(255,255,255,${0.05 + rnd() * 0.14})`
      : `rgba(0,0,0,${0.06 + rnd() * 0.16})`;
    x.lineWidth = 0.8 + rnd() * 2.2;
    x.beginPath();
    x.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
    x.quadraticCurveTo(
      Math.cos(ang + wob) * (r0 + r1) * 0.5,
      Math.sin(ang + wob) * (r0 + r1) * 0.5,
      Math.cos(ang + wob * 0.5) * r1,
      Math.sin(ang + wob * 0.5) * r1,
    );
    x.stroke();
  }
  // Crypts: a few small dark radial pits in the mid-iris.
  for (let i = 0; i < 18; i++) {
    const ang = rnd() * Math.PI * 2;
    const rr = R * (0.45 + rnd() * 0.3);
    x.save();
    x.rotate(ang);
    x.fillStyle = `rgba(0,0,0,${0.1 + rnd() * 0.14})`;
    x.beginPath();
    x.ellipse(rr, 0, R * (0.05 + rnd() * 0.05), R * (0.018 + rnd() * 0.02), 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
  // Wavy collarette line where the inner ring meets the main iris.
  x.strokeStyle = "rgba(255,255,255,0.16)";
  x.lineWidth = 2;
  x.beginPath();
  for (let i = 0; i <= 64; i++) {
    const ang = (i / 64) * Math.PI * 2;
    const rr = R * (0.42 + Math.sin(ang * 9 + 1.3) * 0.025 + Math.sin(ang * 4) * 0.015);
    if (i === 0) x.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    else x.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
  }
  x.stroke();

  // Soft outer edge and an open pupil, so the real pupil (and its size) always shows through.
  x.globalCompositeOperation = "destination-in";
  const alpha = x.createRadialGradient(0, 0, 0, 0, 0, R);
  alpha.addColorStop(0, "rgba(0,0,0,0)");
  alpha.addColorStop(0.24, "rgba(0,0,0,0)");
  alpha.addColorStop(0.33, "rgba(0,0,0,1)");
  alpha.addColorStop(0.9, "rgba(0,0,0,1)");
  alpha.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = alpha;
  x.fillRect(-R, -R, N, N);
  irisCache.set(color, c);
  return c;
}

export interface BeautyRenderer {
  draw(
    ctx: CanvasRenderingContext2D,
    face: NormalizedLandmark[] | null,
    recipe: BeautyRecipe,
  ): void;
}

export function createBeautyRenderer(width: number, height: number): BeautyRenderer {
  // Reduced-resolution scratch canvases: blurring a smaller copy and scaling it back up is far
  // cheaper than a full-size blur and looks the same once it's blurred anyway.
  const S = 0.4;
  const lw = Math.max(2, Math.round(width * S));
  const lh = Math.max(2, Math.round(height * S));
  const mk = (w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return [c, c.getContext("2d")!] as const;
  };
  const [smoothC, smoothX] = mk(lw, lh);
  const [maskC, maskX] = mk(lw, lh);
  const gw = Math.max(2, Math.round(width * 0.25));
  const gh = Math.max(2, Math.round(height * 0.25));
  const [glowC, glowX] = mk(gw, gh);
  // Full-res snapshot of the eye area, for putting the real catchlights back after recoloring.
  const [snapC, snapX] = mk(2, 2);
  // Scratch layer for feathered shapes (see soft()).
  const [layC, layX] = mk(2, 2);

  /**
   * Paints into a scratch layer that covers only `pts`' bounding box (padded for the blur), then
   * composites it onto the frame blurred. A canvas `filter` on a plain fill makes the browser
   * blur a whole-frame layer; bounding it to the few hundred pixels around an eye or the cheeks
   * is what keeps soft makeup edges cheap enough for a phone at full frame rate.
   */
  function soft(
    ctx: CanvasRenderingContext2D,
    pts: Pt[],
    blur: number,
    paint: (c: CanvasRenderingContext2D) => void,
    composites: [GlobalCompositeOperation, number][],
  ) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const pad = Math.ceil(blur * 3) + 2;
    const x = Math.max(0, Math.floor(x0 - pad));
    const y = Math.max(0, Math.floor(y0 - pad));
    const w = Math.min(width, Math.ceil(x1 + pad)) - x;
    const h = Math.min(height, Math.ceil(y1 + pad)) - y;
    if (w < 1 || h < 1) return;
    if (layC.width < w || layC.height < h) {
      layC.width = Math.max(layC.width, w);
      layC.height = Math.max(layC.height, h);
    }
    layX.setTransform(1, 0, 0, 1, 0, 0);
    layX.globalCompositeOperation = "source-over";
    layX.globalAlpha = 1;
    layX.clearRect(0, 0, w, h);
    layX.setTransform(1, 0, 0, 1, -x, -y);
    paint(layX);
    layX.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    for (const [op, alpha] of composites) {
      ctx.globalCompositeOperation = op;
      ctx.globalAlpha = alpha;
      ctx.drawImage(layC, 0, 0, w, h, x, y, w, h);
    }
    ctx.restore();
  }

  let vignetteFor = -1;
  let vignetteGrad: CanvasGradient | null = null;

  // Freckles are bound to the nearest mesh landmark (plus a small offset) the first time a face is
  // seen roughly head-on, so afterwards they ride the skin as the head turns instead of sliding
  // across it the way a flat 2D stamp would.
  let freckles: (FreckleSpec & { idx: number; ox: number; oy: number })[] | null = null;

  const px = (p: NormalizedLandmark): Pt => ({ x: p.x * width, y: p.y * height });

  function ring(c: CanvasRenderingContext2D, face: NormalizedLandmark[], idx: number[], s = 1) {
    idx.forEach((i, n) => {
      const p = face[i];
      const x = p.x * width * s;
      const y = p.y * height * s;
      if (n === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.closePath();
  }

  function frame(face: NormalizedLandmark[]) {
    const a = px(face[EYE_OUTER_R]);
    const b = px(face[EYE_OUTER_L]);
    const D = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ex = { x: (b.x - a.x) / D, y: (b.y - a.y) / D };
    const ey = { x: -ex.y, y: ex.x };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return { D, ex, ey, mid, angle: Math.atan2(ex.y, ex.x) };
  }
  type Frame = ReturnType<typeof frame>;

  /** A soft, feathered elliptical spot aligned with the face. */
  function spot(
    ctx: CanvasRenderingContext2D,
    f: Frame,
    c: Pt,
    rx: number,
    ry: number,
    rgb: string,
    alpha: number,
    rot = 0,
  ) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(f.angle + rot);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.5, `rgba(${rgb},${alpha * 0.55})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Cheek-apple centers: between the outer eye corner and the mouth corner, nudged to the cheek. */
  function cheekApples(face: NormalizedLandmark[]): [Pt, Pt] {
    const one = (eye: number, mouth: number, cheek: number) =>
      lerp(lerp(px(face[eye]), px(face[mouth]), 0.42), px(face[cheek]), 0.1);
    return [one(EYE_OUTER_R, MOUTH_R, CHEEK_R), one(EYE_OUTER_L, MOUTH_L, CHEEK_L)];
  }

  function skinMask(face: NormalizedLandmark[], D: number) {
    // Feathered skin mask: the face oval minus eyes, brows, lips and nostrils.
    maskX.globalCompositeOperation = "source-over";
    maskX.clearRect(0, 0, lw, lh);
    maskX.filter = `blur(${Math.max(1, D * 0.045 * S)}px)`;
    maskX.fillStyle = "#fff";
    maskX.beginPath();
    ring(maskX, face, FACE_OVAL, S);
    maskX.fill();
    maskX.globalCompositeOperation = "destination-out";
    maskX.lineJoin = "round";
    maskX.lineWidth = D * 0.07 * S;
    maskX.strokeStyle = "#000";
    maskX.fillStyle = "#000";
    for (const idx of [RIGHT_EYE, LEFT_EYE, RIGHT_BROW, LEFT_BROW, LIPS_OUTER]) {
      maskX.beginPath();
      ring(maskX, face, idx, S);
      maskX.fill();
      maskX.stroke();
    }
    const n = lerp(px(face[NOSE_TIP]), px(face[SUBNASALE]), 0.7);
    const { angle } = frame(face);
    maskX.beginPath();
    maskX.ellipse(n.x * S, n.y * S, D * 0.17 * S, D * 0.055 * S, angle, 0, Math.PI * 2);
    maskX.fill();
    maskX.filter = "none";
    maskX.globalCompositeOperation = "source-over";
  }

  function skinSmooth(
    ctx: CanvasRenderingContext2D,
    face: NormalizedLandmark[],
    amt: number,
    D: number,
  ) {
    smoothX.globalCompositeOperation = "source-over";
    smoothX.clearRect(0, 0, lw, lh);
    smoothX.filter = `blur(${Math.max(1, D * 0.05 * S)}px)`;
    smoothX.drawImage(ctx.canvas, 0, 0, lw, lh);
    smoothX.filter = "none";
    skinMask(face, D);
    smoothX.globalCompositeOperation = "destination-in";
    smoothX.drawImage(maskC, 0, 0);
    smoothX.globalCompositeOperation = "source-over";

    ctx.save();
    // The retoucher's trick: "lighten" with the local average only lifts what's DARKER than the
    // surrounding skin — pores, blemishes, fine lines, uneven patches — and leaves the skin's own
    // highlights and texture alone, so it evens the skin without the plastic blur look.
    ctx.globalCompositeOperation = "lighten";
    ctx.globalAlpha = Math.min(1, amt * 0.85);
    ctx.drawImage(smoothC, 0, 0, width, height);
    // A light overall soften on top, so it still reads as retouched skin.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = amt * 0.3;
    ctx.drawImage(smoothC, 0, 0, width, height);
    ctx.restore();
  }

  function sculpt(
    ctx: CanvasRenderingContext2D,
    face: NormalizedLandmark[],
    amt: number,
    f: Frame,
  ) {
    const { D, ey, mid } = f;
    const noseTip = px(face[NOSE_TIP]);
    ctx.save();
    // Dodge: the high planes of the face catch the light.
    ctx.globalCompositeOperation = "soft-light";
    const bridge = lerp(mid, noseTip, 0.45);
    spot(ctx, f, bridge, D * 0.2, D * 0.045, "255,255,255", 0.55 * amt, Math.PI / 2);
    const fh = lerp(mid, px(face[FOREHEAD]), 0.55);
    spot(ctx, f, fh, D * 0.24, D * 0.12, "255,255,255", 0.4 * amt);
    const chin = lerp(px(face[CHIN]), px(face[LOWER_LIP_OUTER]), 0.4);
    spot(ctx, f, chin, D * 0.12, D * 0.07, "255,255,255", 0.4 * amt);
    for (const [eye, cheek, dir] of [
      [EYE_OUTER_R, CHEEK_R, 1],
      [EYE_OUTER_L, CHEEK_L, -1],
    ] as const) {
      const c = lerp(px(face[eye]), px(face[cheek]), 0.3);
      const cb = { x: c.x + ey.x * D * 0.13, y: c.y + ey.y * D * 0.13 };
      spot(ctx, f, cb, D * 0.16, D * 0.05, "255,255,255", 0.45 * amt, dir * 0.45);
    }
    // Burn: a soft shadow in the hollow under each cheekbone.
    ctx.globalCompositeOperation = "multiply";
    for (const [cheek, mouth, dir] of [
      [CHEEK_R, MOUTH_R, 1],
      [CHEEK_L, MOUTH_L, -1],
    ] as const) {
      const c = lerp(px(face[cheek]), px(face[mouth]), 0.28);
      const h = { x: c.x + ey.x * D * 0.06, y: c.y + ey.y * D * 0.06 };
      spot(ctx, f, h, D * 0.2, D * 0.06, "150,105,85", 0.35 * amt, dir * -0.5);
    }
    ctx.restore();
  }

  function dewy(ctx: CanvasRenderingContext2D, face: NormalizedLandmark[], amt: number, f: Frame) {
    // Glass skin: small, bright, soft specular highlights exactly where light hits dewy skin.
    const { D, ey, mid } = f;
    const noseTip = px(face[NOSE_TIP]);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const w = "255,250,245";
    spot(ctx, f, lerp(mid, noseTip, 0.5), D * 0.17, D * 0.026, w, 0.75 * amt, Math.PI / 2);
    spot(ctx, f, lerp(mid, noseTip, 0.92), D * 0.035, D * 0.026, w, 0.7 * amt);
    spot(ctx, f, lerp(mid, px(face[FOREHEAD]), 0.5), D * 0.14, D * 0.06, w, 0.45 * amt);
    const cupid = px(face[UPPER_LIP_TOP]);
    spot(
      ctx,
      f,
      { x: cupid.x - ey.x * D * 0.025, y: cupid.y - ey.y * D * 0.025 },
      D * 0.035,
      D * 0.014,
      w,
      0.5 * amt,
    );
    // Cheekbones: an elongated sheen on the top of each cheek apple, angled up toward the ear —
    // a soft-light wash for the gloss plus a small screened core for the actual catch of light.
    const apples = cheekApples(face);
    for (const [k, eye, dir] of [
      [0, EYE_OUTER_R, 1],
      [1, EYE_OUTER_L, -1],
    ] as const) {
      const c = lerp(apples[k], px(face[eye]), 0.38);
      ctx.globalCompositeOperation = "soft-light";
      spot(ctx, f, c, D * 0.16, D * 0.06, w, 0.9 * amt, dir * 0.55);
      ctx.globalCompositeOperation = "screen";
      spot(ctx, f, c, D * 0.09, D * 0.028, w, 0.4 * amt, dir * 0.55);
    }
    ctx.restore();
  }

  function glow(ctx: CanvasRenderingContext2D, amt: number) {
    glowX.clearRect(0, 0, gw, gh);
    glowX.filter = `blur(${Math.max(2, gw * 0.025)}px)`;
    glowX.drawImage(ctx.canvas, 0, 0, gw, gh);
    glowX.filter = "none";
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = amt;
    ctx.drawImage(glowC, 0, 0, width, height);
    ctx.restore();
  }

  function vignette(ctx: CanvasRenderingContext2D, amt: number) {
    if (vignetteFor !== amt || !vignetteGrad) {
      const cx = width / 2;
      const cy = height * 0.45;
      const g = ctx.createRadialGradient(
        cx,
        cy,
        Math.min(width, height) * 0.38,
        cx,
        cy,
        Math.hypot(width, height) * 0.62,
      );
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${amt})`);
      vignetteGrad = g;
      vignetteFor = amt;
    }
    ctx.save();
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function eyePop(ctx: CanvasRenderingContext2D, face: NormalizedLandmark[], amt: number) {
    ctx.save();
    ctx.beginPath();
    ring(ctx, face, RIGHT_EYE);
    ring(ctx, face, LEFT_EYE);
    ctx.clip();
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = `rgba(255,255,255,${amt})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function underEye(
    ctx: CanvasRenderingContext2D,
    face: NormalizedLandmark[],
    amt: number,
    f: Frame,
  ) {
    const { D, ey } = f;
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    for (const [o, i] of [
      [EYE_OUTER_R, EYE_INNER_R],
      [EYE_OUTER_L, EYE_INNER_L],
    ]) {
      const c = lerp(px(face[o]), px(face[i]), 0.55);
      const u = { x: c.x + ey.x * D * 0.12, y: c.y + ey.y * D * 0.12 };
      spot(ctx, f, u, D * 0.15, D * 0.055, "255,240,225", 0.6 * amt);
    }
    ctx.restore();
  }

  function teeth(ctx: CanvasRenderingContext2D, face: NormalizedLandmark[], amt: number) {
    ctx.save();
    ctx.beginPath();
    ring(ctx, face, LIPS_INNER);
    ctx.clip();
    // Pull the yellow out, then lift a touch — whiter, but still real teeth, not a white bar.
    ctx.globalCompositeOperation = "saturation";
    ctx.fillStyle = `rgba(128,128,128,${0.55 * amt})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = `rgba(255,255,255,${0.35 * amt})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  /** The upper-lid points of an eye ring, outer corner first. */
  const upperLid = (eye: number[]) => eye.slice(0, 9);

  function eyeshadow(
    ctx: CanvasRenderingContext2D,
    face: NormalizedLandmark[],
    rgb: string,
    f: Frame,
  ) {
    const { D } = f;
    const sides = [
      [RIGHT_EYE, RIGHT_BROW_LOW],
      [LEFT_EYE, LEFT_BROW_LOW],
    ].map(([eye, brow]) => ({
      lid: upperLid(eye).map((i) => px(face[i])),
      brow: brow.map((i) => px(face[i])),
    }));
    soft(
      ctx,
      sides.flatMap((sd) => [...sd.lid, ...sd.brow]),
      Math.max(1, D * 0.025),
      (c) => {
        for (const { lid, brow } of sides) {
          // Deepest along the lash line, fading out before the brow, how shadow is blended.
          const g = c.createLinearGradient(lid[4].x, lid[4].y, brow[2].x, brow[2].y);
          g.addColorStop(0, `rgba(${rgb},0.65)`);
          g.addColorStop(0.55, `rgba(${rgb},0.26)`);
          g.addColorStop(0.9, `rgba(${rgb},0)`);
          c.fillStyle = g;
          c.beginPath();
          lid.forEach((p, n) => (n === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
          for (const p of brow) c.lineTo(p.x, p.y);
          c.closePath();
          c.fill();
        }
      },
      [["multiply", 1]],
    );
    // A little shimmer in the middle of each lid.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const { lid, brow } of sides) {
      spot(ctx, f, lerp(lid[4], brow[2], 0.22), D * 0.06, D * 0.025, "255,226,190", 0.35);
    }
    ctx.restore();
  }

  function eyeliner(
    ctx: CanvasRenderingContext2D,
    face: NormalizedLandmark[],
    amt: number,
    f: Frame,
  ) {
    const { D, ey } = f;
    const up = { x: -ey.x, y: -ey.y };
    const sides: [number[], number][] = [
      [RIGHT_EYE, EYE_INNER_R],
      [LEFT_EYE, EYE_INNER_L],
    ];
    const shapes = sides.map(([eye, inner]) => {
      const lid = upperLid(eye).map((i) => px(face[i]));
      const n = lid.length;
      // Thick at the outer corner, tapering to a hairline at the inner corner.
      const top = lid.map((p, k) => {
        const t = D * (0.02 - (0.016 * k) / (n - 1));
        return { x: p.x + up.x * t, y: p.y + up.y * t };
      });
      const outer = lid[0];
      const innerPt = px(face[inner]);
      const len = Math.hypot(outer.x - innerPt.x, outer.y - innerPt.y) || 1;
      const out = { x: (outer.x - innerPt.x) / len, y: (outer.y - innerPt.y) / len };
      const wing = {
        x: outer.x + out.x * D * 0.085 + up.x * D * 0.045,
        y: outer.y + out.y * D * 0.085 + up.y * D * 0.045,
      };
      return [wing, ...top, ...lid.slice().reverse()];
    });
    soft(
      ctx,
      shapes.flat(),
      Math.max(0.35, D * 0.003),
      (c) => {
        c.fillStyle = "rgb(18,12,14)";
        for (const poly of shapes) {
          c.beginPath();
          poly.forEach((p, k) => (k === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
          c.closePath();
          c.fill();
        }
      },
      [["source-over", 0.85 * amt]],
    );
  }

  function eyeColor(ctx: CanvasRenderingContext2D, face: NormalizedLandmark[], color: IrisColor) {
    if (face.length < 478) return;
    const irises: { c: Pt; r: number }[] = [];
    for (const [center, rim] of IRISES) {
      const c = px(face[center]);
      const r =
        rim.reduce((s, i) => {
          const p = px(face[i]);
          return s + Math.hypot(p.x - c.x, p.y - c.y);
        }, 0) / rim.length;
      if (r >= 1.5) irises.push({ c, r });
    }
    if (!irises.length) return;

    // Snapshot the real eye pixels first — their catchlights go back on top at the end.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const { c, r } of irises) {
      x0 = Math.min(x0, c.x - r);
      y0 = Math.min(y0, c.y - r);
      x1 = Math.max(x1, c.x + r);
      y1 = Math.max(y1, c.y + r);
    }
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    const bw = Math.min(width, Math.ceil(x1)) - x0;
    const bh = Math.min(height, Math.ceil(y1)) - y0;
    if (bw < 2 || bh < 2) return;
    if (snapC.width < bw || snapC.height < bh) {
      snapC.width = Math.max(snapC.width, bw);
      snapC.height = Math.max(snapC.height, bh);
    }
    snapX.clearRect(0, 0, snapC.width, snapC.height);
    snapX.drawImage(ctx.canvas, x0, y0, bw, bh, 0, 0, bw, bh);

    const tex = irisTexture(color);
    const { ey } = frame(face);
    ctx.save();
    // Clip to the eye openings so the lids cover the new iris exactly like they cover the real one.
    ctx.beginPath();
    ring(ctx, face, RIGHT_EYE);
    ring(ctx, face, LEFT_EYE);
    ctx.clip();
    for (const { c, r } of irises) {
      const s = r * 1.1;
      // 1) Shift the real iris's hue toward the new color (keeps its own light and shading)…
      ctx.globalCompositeOperation = "color";
      ctx.globalAlpha = 0.7;
      ctx.drawImage(tex, c.x - s, c.y - s, s * 2, s * 2);
      // 2) …then lay the textured iris over it, semi-transparent like a tinted lens.
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.36;
      ctx.drawImage(tex, c.x - s, c.y - s, s * 2, s * 2);
      ctx.globalAlpha = 1;
      // 3) The upper lid's soft shadow across the top of the iris.
      const top = { x: c.x - ey.x * r, y: c.y - ey.y * r };
      const g = ctx.createLinearGradient(top.x, top.y, c.x + ey.x * r * 0.1, c.y + ey.y * r * 0.1);
      g.addColorStop(0, "rgba(0,0,0,0.45)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, s, 0, Math.PI * 2);
      ctx.fill();
    }
    // 4) Put the real catchlights back: only the brightest snapshot pixels survive the contrast
    //    crush, and "lighten" lets just those through — the reflection of the room in the eye is
    //    what sells it as a real eye.
    ctx.beginPath();
    for (const { c, r } of irises) {
      ctx.moveTo(c.x + r * 0.92, c.y);
      ctx.arc(c.x, c.y, r * 0.92, 0, Math.PI * 2);
    }
    ctx.clip();
    ctx.globalCompositeOperation = "lighten";
    ctx.filter = "brightness(0.85) contrast(4)";
    ctx.drawImage(snapC, 0, 0, bw, bh, x0, y0, bw, bh);
    ctx.restore();
  }

  function blush(ctx: CanvasRenderingContext2D, face: NormalizedLandmark[], amt: number, f: Frame) {
    const { D, mid } = f;
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    for (const c of cheekApples(face))
      spot(ctx, f, c, D * 0.25, D * 0.18, "226,112,118", 0.3 * amt);
    // The sun-kissed swipe across the nose bridge that ties the two cheeks together.
    const nose = lerp(mid, px(face[NOSE_TIP]), 0.5);
    spot(ctx, f, nose, D * 0.2, D * 0.07, "226,112,118", 0.3 * amt);
    ctx.restore();
  }

  function drawFreckles(ctx: CanvasRenderingContext2D, face: NormalizedLandmark[], f: Frame) {
    const { D, ex, ey, mid } = f;
    if (!freckles) {
      // Bind only from a roughly frontal pose, so the pattern is laid out on the face evenly.
      const n = px(face[NOSE_TIP]);
      const yaw = Math.abs((n.x - mid.x) * ex.x + (n.y - mid.y) * ex.y) / D;
      if (yaw > 0.07) return;
      const limit = Math.min(face.length, 468);
      freckles = FRECKLE_TEMPLATE.map((fr) => {
        const p = {
          x: mid.x + (ex.x * fr.lx + ey.x * fr.ly) * D,
          y: mid.y + (ex.y * fr.lx + ey.y * fr.ly) * D,
        };
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < limit; i++) {
          const q = px(face[i]);
          const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        const q = px(face[best]);
        const ox = ((p.x - q.x) * ex.x + (p.y - q.y) * ex.y) / D;
        const oy = ((p.x - q.x) * ey.x + (p.y - q.y) * ey.y) / D;
        return { ...fr, idx: best, ox, oy };
      });
    }
    const placed = freckles.map((fr) => {
      const q = px(face[fr.idx]);
      const x = q.x + (ex.x * fr.ox + ey.x * fr.oy) * D;
      const y = q.y + (ex.y * fr.ox + ey.y * fr.oy) * D;
      return { fr, x, y };
    });
    soft(
      ctx,
      placed,
      Math.max(0.35, D * 0.0022),
      (c) => {
        for (const { fr, x, y } of placed) {
          const r = Math.max(0.5, fr.r * D);
          const r2 = Math.max(0.4, fr.r2 * D);
          const ox = x + (ex.x * fr.dx + ey.x * fr.dy) * D;
          const oy = y + (ex.y * fr.dx + ey.y * fr.dy) * D;
          c.fillStyle = `rgba(${FRECKLE_TONES[fr.tone]},${fr.a})`;
          c.beginPath();
          c.ellipse(x, y, r, r * 0.8, f.angle + fr.tone, 0, Math.PI * 2);
          c.moveTo(ox + r2, oy);
          c.ellipse(ox, oy, r2, r2 * 0.85, f.angle, 0, Math.PI * 2);
          c.fill();
        }
      },
      [["multiply", 1]],
    );
  }

  function lips(ctx: CanvasRenderingContext2D, face: NormalizedLandmark[], rgb: string, f: Frame) {
    const { D } = f;
    // Hue from "color" keeps every crease and highlight of the real lips; a light multiply gives
    // the pigment depth. Together they read as lipstick ON the lips, not a sticker over them.
    soft(
      ctx,
      LIPS_OUTER.map((i) => px(face[i])),
      Math.max(0.5, D * 0.005),
      (c) => {
        c.fillStyle = `rgb(${rgb})`;
        c.beginPath();
        ring(c, face, LIPS_OUTER);
        ring(c, face, LIPS_INNER);
        c.fill("evenodd");
      },
      [
        ["color", 0.42],
        ["multiply", 0.34],
      ],
    );
    // Gloss: a soft highlight across the middle of the lower lip.
    const a = px(face[LOWER_LIP_INNER]);
    const b = px(face[LOWER_LIP_OUTER]);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    spot(
      ctx,
      f,
      lerp(a, b, 0.45),
      D * 0.075,
      Math.max(1, Math.hypot(b.x - a.x, b.y - a.y) * 0.2),
      "255,255,255",
      0.4,
    );
    ctx.restore();
  }

  return {
    draw(ctx, face, r) {
      const f = face ? frame(face) : null;
      const fc = f && f.D > 4 ? face! : null;
      if (fc && f) {
        if (r.smooth) skinSmooth(ctx, fc, r.smooth, f.D);
        if (r.sculpt) sculpt(ctx, fc, r.sculpt, f);
        if (r.dewy) dewy(ctx, fc, r.dewy, f);
      }
      if (r.glow) glow(ctx, r.glow);
      if (fc && f) {
        if (r.blush) blush(ctx, fc, r.blush, f);
        if (r.freckles) drawFreckles(ctx, fc, f);
        if (r.underEye) underEye(ctx, fc, r.underEye, f);
        if (r.shadow) eyeshadow(ctx, fc, r.shadow, f);
        if (r.lips) lips(ctx, fc, r.lips, f);
        if (r.teeth) teeth(ctx, fc, r.teeth);
        if (r.eyePop) eyePop(ctx, fc, r.eyePop);
        if (r.eyes) eyeColor(ctx, fc, r.eyes);
        if (r.liner) eyeliner(ctx, fc, r.liner, f);
      }
      if (r.vignette) vignette(ctx, r.vignette);
    },
  };
}
