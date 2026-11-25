/**
 * Face-aware "beauty" looks for the selfie camera — the part of a look that a whole-frame CSS
 * grade (video-filters.ts) can't do on its own: Photoshop-style skin retouching, freckles, eye
 * color, blush and lip tint, all anchored to the face MediaPipe's landmarker finds each frame.
 *
 * Runs inside camera-effects.ts's draw loop, right after the frame is drawn through the look's
 * grade, so — exactly like the grade and the overlay props — whatever it paints is baked into the
 * recorded take, not just the preview.
 *
 * Everything here is plain 2D-canvas work (paths, gradients, blend modes and `ctx.filter` blurs on
 * a reduced-resolution copy), no WebGL, so it runs on the same phones the rest of the camera
 * pipeline already does.
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type BeautyRecipe = {
  /** Skin smoothing strength, 0..1 — blurred skin blended back over the face, eyes/brows/lips kept sharp. */
  smooth?: number;
  /** Soft studio glow (blurred copy screened over the frame), 0..1. */
  glow?: number;
  /** Darkened corners, 0..1. */
  vignette?: number;
  /** Brighten the eyes a touch (retoucher's "eye pop"), 0..1. */
  eyePop?: number;
  freckles?: boolean;
  /** Rosy cheeks + a sun-kissed swipe over the nose, 0..1. */
  blush?: number;
  /** Lip tint color, as "r,g,b". */
  lips?: string;
  /** Iris color, as "r,g,b". */
  eyes?: string;
};

/** Whether a recipe needs face landmarks at all (glow/vignette alone don't). */
export function recipeNeedsFace(r: BeautyRecipe | undefined): boolean {
  return !!r && !!(r.smooth || r.eyePop || r.freckles || r.blush || r.lips || r.eyes);
}

// Standard MediaPipe face-mesh rings (same topology as face-filters.ts's anchor indices).
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
  176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const RIGHT_EYE = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const LEFT_EYE = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
const RIGHT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const LEFT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
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
const EYE_OUTER_R = 33;
const EYE_OUTER_L = 263;
const MOUTH_R = 61;
const MOUTH_L = 291;
const CHEEK_R = 234;
const CHEEK_L = 454;
const LOWER_LIP_INNER = 14;
const LOWER_LIP_OUTER = 17;

type Pt = { x: number; y: number };

// Small seeded PRNG so freckles land in the same pattern every take (and every frame).
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
 * Freckle pattern in a face-local frame: x along the eye line, y down the face, both in units of
 * the outer-eye-corner distance, origin at the midpoint between the outer corners. The band
 * covers the nose bridge and upper cheeks — where real sun freckles cluster — and skips the eyes
 * and nostrils.
 */
const FRECKLE_TEMPLATE = (() => {
  const rnd = mulberry32(2611);
  const out: { lx: number; ly: number; r: number; a: number }[] = [];
  let guard = 0;
  while (out.length < 120 && guard++ < 5000) {
    const lx = (rnd() * 2 - 1) * 0.62;
    const ly = 0.1 + rnd() * 0.38;
    const inBand = (lx / 0.6) ** 2 + ((ly - 0.28) / 0.17) ** 2 <= 1;
    if (!inBand || ly < 0.13) continue;
    if (ly > 0.4 && Math.abs(lx) < 0.15) continue; // nostrils
    // Densest over the bridge and the cheek apples, thinning toward the outer cheeks.
    const ax = Math.abs(lx);
    const w = Math.max(ax < 0.12 ? 1 : 0, Math.exp(-((ax - 0.3) ** 2) / 0.018), 0.3);
    if (rnd() > w) continue;
    const s = rnd();
    out.push({ lx, ly, r: 0.0042 + s * s * 0.0085, a: 0.22 + rnd() * 0.36 });
  }
  return out;
})();

export interface BeautyRenderer {
  draw(
    ctx: CanvasRenderingContext2D,
    face: NormalizedLandmark[] | null,
    recipe: BeautyRecipe,
  ): void;
}

export function createBeautyRenderer(width: number, height: number): BeautyRenderer {
  // Reduced-resolution scratch canvases: blurring a third-size copy and scaling it back up is far
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

  let vignetteFor = -1;
  let vignetteGrad: CanvasGradient | null = null;

  // Freckles are bound to the nearest mesh landmark (plus a small offset) the first time a face is
  // seen roughly head-on, so afterwards they ride the skin as the head turns instead of sliding
  // across it the way a flat 2D stamp would.
  let freckles: { idx: number; ox: number; oy: number; r: number; a: number }[] | null = null;

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
    return { D, ex, ey, mid };
  }

  function skinSmooth(
    ctx: CanvasRenderingContext2D,
    face: NormalizedLandmark[],
    amt: number,
    D: number,
  ) {
    // 1) Blurred low-res copy of the current (already graded) frame.
    smoothX.globalCompositeOperation = "source-over";
    smoothX.clearRect(0, 0, lw, lh);
    smoothX.filter = `blur(${Math.max(1, D * 0.055 * S)}px)`;
    smoothX.drawImage(ctx.canvas, 0, 0, lw, lh);
    smoothX.filter = "none";

    // 2) Feathered skin mask: the face oval minus eyes, brows and lips.
    maskX.globalCompositeOperation = "source-over";
    maskX.clearRect(0, 0, lw, lh);
    maskX.filter = `blur(${Math.max(1, D * 0.05 * S)}px)`;
    maskX.fillStyle = "#fff";
    maskX.beginPath();
    ring(maskX, face, FACE_OVAL, S);
    maskX.fill();
    maskX.globalCompositeOperation = "destination-out";
    maskX.lineJoin = "round";
    maskX.lineWidth = D * 0.07 * S;
    maskX.strokeStyle = "#000";
    for (const idx of [RIGHT_EYE, LEFT_EYE, RIGHT_BROW, LEFT_BROW, LIPS_OUTER]) {
      maskX.beginPath();
      ring(maskX, face, idx, S);
      maskX.fill();
      maskX.stroke();
    }
    maskX.filter = "none";
    maskX.globalCompositeOperation = "source-over";

    // 3) Keep the blur only where the mask is, then lay it back over the face. Partial strength
    //    leaves some real texture through — a retouch, not a plastic mask.
    smoothX.globalCompositeOperation = "destination-in";
    smoothX.drawImage(maskC, 0, 0);
    smoothX.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalAlpha = amt;
    ctx.drawImage(smoothC, 0, 0, width, height);
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

  function eyeColor(
    ctx: CanvasRenderingContext2D,
    face: NormalizedLandmark[],
    rgb: string,
    D: number,
  ) {
    if (face.length < 478) return;
    ctx.save();
    // Clip to both eye openings so the eyelids cover the tint exactly the way they cover the iris.
    ctx.beginPath();
    ring(ctx, face, RIGHT_EYE);
    ring(ctx, face, LEFT_EYE);
    ctx.clip();
    ctx.filter = `blur(${Math.max(0.4, D * 0.004)}px)`;
    for (const [center, rim] of IRISES) {
      const c = px(face[center]);
      const r =
        rim.reduce((s, i) => {
          const p = px(face[i]);
          return s + Math.hypot(p.x - c.x, p.y - c.y);
        }, 0) / rim.length;
      if (r < 1) continue;
      const iris = (alpha: number) => {
        const g = ctx.createRadialGradient(c.x, c.y, r * 0.22, c.x, c.y, r * 1.02);
        g.addColorStop(0, `rgba(${rgb},0)`);
        g.addColorStop(0.3, `rgba(${rgb},${alpha})`);
        g.addColorStop(0.85, `rgba(${rgb},${alpha})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        return g;
      };
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 1.02, 0, Math.PI * 2);
      // Hue from "color", then a "screen" lift so even very dark eyes actually read as the color.
      ctx.globalCompositeOperation = "color";
      ctx.fillStyle = iris(0.78);
      ctx.fill();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = iris(0.2);
      ctx.fill();
      // Darker limbal ring at the rim — what makes a tinted iris look real instead of painted.
      ctx.globalCompositeOperation = "multiply";
      ctx.strokeStyle = "rgba(25,30,40,0.35)";
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 0.93, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function blush(
    ctx: CanvasRenderingContext2D,
    face: NormalizedLandmark[],
    amt: number,
    D: number,
  ) {
    const lerp = (p: Pt, q: Pt, t: number): Pt => ({
      x: p.x + (q.x - p.x) * t,
      y: p.y + (q.y - p.y) * t,
    });
    const { ex, mid } = frame(face);
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    const spot = (c: Pt, rx: number, ry: number, alpha: number) => {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.atan2(ex.y, ex.x));
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `rgba(226,112,118,${alpha})`);
      g.addColorStop(0.55, `rgba(226,112,118,${alpha * 0.5})`);
      g.addColorStop(1, "rgba(226,112,118,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    // Cheek apples: between the outer eye corner and the mouth corner, nudged toward the cheek.
    for (const [eye, mouth, cheek] of [
      [EYE_OUTER_R, MOUTH_R, CHEEK_R],
      [EYE_OUTER_L, MOUTH_L, CHEEK_L],
    ]) {
      const c = lerp(lerp(px(face[eye]), px(face[mouth]), 0.42), px(face[cheek]), 0.1);
      spot(c, D * 0.25, D * 0.18, 0.3 * amt);
    }
    // The sun-kissed swipe across the nose bridge that ties the two cheeks together.
    const nose = lerp(mid, px(face[NOSE_TIP]), 0.5);
    spot(nose, D * 0.2, D * 0.07, 0.3 * amt);
    ctx.restore();
  }

  function drawFreckles(ctx: CanvasRenderingContext2D, face: NormalizedLandmark[]) {
    const { D, ex, ey, mid } = frame(face);
    if (!freckles) {
      // Bind only from a roughly frontal pose, so the pattern is laid out on the face evenly.
      const n = px(face[NOSE_TIP]);
      const yaw = Math.abs((n.x - mid.x) * ex.x + (n.y - mid.y) * ex.y) / D;
      if (yaw > 0.07) return;
      const limit = Math.min(face.length, 468);
      freckles = FRECKLE_TEMPLATE.map((f) => {
        const p = {
          x: mid.x + (ex.x * f.lx + ey.x * f.ly) * D,
          y: mid.y + (ex.y * f.lx + ey.y * f.ly) * D,
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
        return { idx: best, ox, oy, r: f.r, a: f.a };
      });
    }
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.filter = `blur(${Math.max(0.35, D * 0.0025)}px)`;
    // Bucketed by opacity so the whole pattern is a handful of fills, not one per freckle.
    const buckets = [0.28, 0.4, 0.52];
    for (const level of buckets) {
      ctx.fillStyle = `rgba(146,86,54,${level})`;
      ctx.beginPath();
      for (const f of freckles) {
        const nearest = buckets.reduce((x, y) => (Math.abs(y - f.a) < Math.abs(x - f.a) ? y : x));
        if (nearest !== level) continue;
        const q = px(face[f.idx]);
        const x = q.x + (ex.x * f.ox + ey.x * f.oy) * D;
        const y = q.y + (ex.y * f.ox + ey.y * f.oy) * D;
        const r = Math.max(0.6, f.r * D);
        ctx.moveTo(x + r, y);
        ctx.ellipse(x, y, r, r * 0.85, Math.atan2(ex.y, ex.x), 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  function lips(ctx: CanvasRenderingContext2D, face: NormalizedLandmark[], rgb: string, D: number) {
    ctx.save();
    ctx.beginPath();
    ring(ctx, face, LIPS_OUTER);
    ring(ctx, face, LIPS_INNER);
    ctx.filter = `blur(${Math.max(0.5, D * 0.006)}px)`;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgba(${rgb},0.42)`;
    ctx.fill("evenodd");
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = `rgba(${rgb},0.6)`;
    ctx.fill("evenodd");
    // Gloss: a soft highlight across the middle of the lower lip.
    const a = px(face[LOWER_LIP_INNER]);
    const b = px(face[LOWER_LIP_OUTER]);
    const { ex } = frame(face);
    ctx.globalCompositeOperation = "screen";
    ctx.filter = `blur(${Math.max(1, D * 0.012)}px)`;
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.beginPath();
    ctx.ellipse(
      a.x + (b.x - a.x) * 0.45,
      a.y + (b.y - a.y) * 0.45,
      D * 0.07,
      Math.max(1, Math.hypot(b.x - a.x, b.y - a.y) * 0.18),
      Math.atan2(ex.y, ex.x),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  return {
    draw(ctx, face, r) {
      const D = face ? frame(face).D : 0;
      const hasFace = !!face && D > 4;
      if (hasFace && r.smooth) skinSmooth(ctx, face!, r.smooth, D);
      if (r.glow) glow(ctx, r.glow);
      if (hasFace && r.blush) blush(ctx, face!, r.blush, D);
      if (hasFace && r.freckles) drawFreckles(ctx, face!);
      if (hasFace && r.lips) lips(ctx, face!, r.lips, D);
      if (hasFace && r.eyePop) eyePop(ctx, face!, r.eyePop);
      if (hasFace && r.eyes) eyeColor(ctx, face!, r.eyes, D);
      if (r.vignette) vignette(ctx, r.vignette);
    },
  };
}
