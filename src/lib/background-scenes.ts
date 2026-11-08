/**
 * The painted scenes behind (and, for the mic scenes, in front of) the singer — kept apart from
 * virtual-background.ts, which owns the segment → composite loop and only asks this file "paint
 * scene X at size W×H".
 *
 * Every scene has up to three layers:
 * - `paint`      static backdrop, painted once per output size and cached as a bitmap;
 * - `animate`    cheap per-frame layer drawn over the backdrop but still *behind* the singer
 *                (moving light beams, twinkling phone lights, fire) — a handful of fills per frame;
 * - `foreground` static layer drawn *over* the singer (a microphone on a stand), cached the same
 *                way as `paint`. The user frames the camera so the mic sits under their mouth.
 *
 * All painters work in plain output pixels and size things off `s = min(w, h)`, so the same scene
 * reads right on a portrait phone feed and a landscape desktop webcam alike. Everything random is
 * seeded, so a scene looks identical frame to frame and between the picker thumbnail and the take.
 */
export type BackgroundId =
  | "none"
  | "brand"
  | "blur"
  | "micStage"
  | "micBooth"
  | "arena"
  | "crowd"
  | "stage"
  | "neon"
  | "city"
  | "studio"
  | "caesarea"
  | "bar"
  | "fireplace"
  | "green"
  | "blue"
  | "coral"
  | "indigo"
  | "teal"
  | "gold";

/** What a freshly opened camera gets until the user picks something else — the branded backdrop. */
export const DEFAULT_BACKGROUND: BackgroundId = "brand";

export const BACKGROUND_OPTIONS: { id: BackgroundId; labelKey: string }[] = [
  { id: "brand", labelKey: "record.bg.brand" },
  { id: "none", labelKey: "record.bg.none" },
  { id: "blur", labelKey: "record.bg.blur" },
  { id: "micStage", labelKey: "record.bg.micStage" },
  { id: "micBooth", labelKey: "record.bg.micBooth" },
  { id: "arena", labelKey: "record.bg.arena" },
  { id: "crowd", labelKey: "record.bg.crowd" },
  { id: "stage", labelKey: "record.bg.stage" },
  { id: "neon", labelKey: "record.bg.neon" },
  { id: "city", labelKey: "record.bg.city" },
  { id: "studio", labelKey: "record.bg.studio" },
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

/** Scenes that put a microphone in front of the singer — the UI nudges the user to line it up. */
export const MIC_BACKGROUNDS: ReadonlySet<BackgroundId> = new Set(["micStage", "micBooth"]);

const BACKGROUND_IDS = new Set(BACKGROUND_OPTIONS.map((o) => o.id));
export function isBackgroundId(v: unknown): v is BackgroundId {
  return typeof v === "string" && BACKGROUND_IDS.has(v as BackgroundId);
}

type Ctx = CanvasRenderingContext2D;

// ─── Assets ──────────────────────────────────────────────────────────────────────────────────────

export interface SceneAssets {
  wordmark: HTMLImageElement | null;
  mark: HTMLImageElement | null;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    // A missing logo shouldn't take the whole background down with it — scenes skip it.
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

let assetsPromise: Promise<SceneAssets> | null = null;
export function loadSceneAssets(): Promise<SceneAssets> {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      loadImage("/brand/logo-wordmark-alpha.png"),
      loadImage("/brand/logo-mark.png"),
    ]).then(([wordmark, mark]) => ({ wordmark, mark }));
  }
  return assetsPromise;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

export function brandColor(id: "coral" | "indigo" | "teal" | "gold"): string {
  return resolveCssVar(`--brand-${id}`);
}

/** The logo ring's rainbow, as fixed stops (matches the mark's own ring artwork). */
const RAINBOW = [
  "#ff2d55",
  "#ff9500",
  "#ffd60a",
  "#34c759",
  "#00c7be",
  "#0a84ff",
  "#bf5af2",
  "#ff2d55",
];

/** Soft radial glow — the shared "stage light" primitive. */
function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number) {
  if (r <= 0 || alpha <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

/**
 * Draws `draw` onto a canvas `factor`× smaller and scales it back up — a soft blur that works on
 * every browser (ctx.filter = "blur()" is still missing on Safari), at a fraction of the cost.
 */
function soft(
  ctx: Ctx,
  w: number,
  h: number,
  factor: number,
  alpha: number,
  draw: (c: Ctx) => void,
) {
  const sw = Math.max(1, Math.round(w / factor));
  const sh = Math.max(1, Math.round(h / factor));
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d")!;
  sctx.scale(sw / w, sh / h);
  draw(sctx);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, w, h);
  ctx.restore();
}

function rainbowStroke(ctx: Ctx, cx: number, cy: number): CanvasGradient | string {
  const conic = (ctx as Ctx & { createConicGradient?: Ctx["createConicGradient"] })
    .createConicGradient;
  if (typeof conic !== "function") return RAINBOW[5];
  const g = ctx.createConicGradient(-Math.PI / 2, cx, cy);
  RAINBOW.forEach((c, i) => g.addColorStop(i / (RAINBOW.length - 1), c));
  return g;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function vignette(ctx: Ctx, w: number, h: number, strength: number) {
  const g = ctx.createRadialGradient(
    w / 2,
    h * 0.45,
    Math.min(w, h) * 0.35,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.8,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** A small pre-rendered light sprite, reused for every twinkle so a frame never builds gradients. */
let lightSprite: HTMLCanvasElement | null = null;
function getLightSprite(): HTMLCanvasElement {
  if (lightSprite) return lightSprite;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,246,222,0.95)");
  g.addColorStop(0.35, "rgba(255,226,170,0.35)");
  g.addColorStop(1, "rgba(255,210,150,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  lightSprite = c;
  return c;
}

interface Twinkle {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
}

function drawTwinkles(ctx: Ctx, lights: Twinkle[], t: number) {
  const sprite = getLightSprite();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const l of lights) {
    const k = 0.5 + 0.5 * Math.sin(t * l.speed + l.phase);
    ctx.globalAlpha = 0.25 + 0.75 * k * k;
    ctx.drawImage(sprite, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.restore();
}

interface BeamRig {
  x: number;
  y: number;
  color: string;
  base: number; // resting angle, radians from straight down
  swing: number;
  speed: number;
  phase: number;
}

/** Concert light beams sweeping from a truss — the one moving element of the stage scenes. */
function drawBeams(ctx: Ctx, w: number, h: number, rigs: BeamRig[], t: number, alpha: number) {
  const len = Math.hypot(w, h) * 1.05;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const b of rigs) {
    const a = b.base + Math.sin(t * b.speed + b.phase) * b.swing;
    const dx = Math.sin(a);
    const dy = Math.cos(a);
    const ex = b.x + dx * len;
    const ey = b.y + dy * len;
    const spread = len * 0.11;
    const g = ctx.createLinearGradient(b.x, b.y, ex, ey);
    g.addColorStop(0, b.color);
    g.addColorStop(0.55, b.color);
    g.addColorStop(1, "transparent");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(b.x - dy * 2, b.y + dx * 2);
    ctx.lineTo(ex - dy * spread, ey + dx * spread);
    ctx.lineTo(ex + dy * spread, ey - dx * spread);
    ctx.lineTo(b.x + dy * 2, b.y - dx * 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Memoizes per-size layout (crowd positions, rigs...) so paint and animate agree exactly. */
function memoBySize<T>(fn: (w: number, h: number) => T) {
  const cache = new Map<string, T>();
  return (w: number, h: number): T => {
    const k = `${w}x${h}`;
    let v = cache.get(k);
    if (!v) {
      v = fn(w, h);
      cache.set(k, v);
    }
    return v;
  };
}

// ─── Microphones (foreground layers) ─────────────────────────────────────────────────────────────

function chromeGradient(ctx: Ctx, x0: number, x1: number) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, "#1b1c20");
  g.addColorStop(0.3, "#d9dce2");
  g.addColorStop(0.45, "#f7f8fa");
  g.addColorStop(0.7, "#5c5f66");
  g.addColorStop(1, "#16171a");
  return g;
}

function meshGrille(ctx: Ctx, cx: number, cy: number, rx: number, ry: number) {
  const g = ctx.createRadialGradient(
    cx - rx * 0.35,
    cy - ry * 0.4,
    rx * 0.05,
    cx,
    cy,
    Math.max(rx, ry) * 1.1,
  );
  g.addColorStop(0, "#f6f7f9");
  g.addColorStop(0.32, "#b9bcc3");
  g.addColorStop(0.7, "#686b73");
  g.addColorStop(1, "#202226");
  ctx.fillStyle = g;
  ctx.fill();
  // Woven mesh: two diagonal line sets, dark then a faint light offset, clipped to the grille.
  ctx.save();
  ctx.clip();
  const step = Math.max(2, Math.min(rx, ry) * 0.13);
  const span = Math.max(rx, ry) * 2.4;
  ctx.lineWidth = Math.max(0.6, step * 0.28);
  for (const [color, off] of [
    ["rgba(10,10,14,0.45)", 0],
    ["rgba(255,255,255,0.12)", step * 0.5],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let d = -span; d <= span; d += step) {
      ctx.moveTo(cx + d + off - span, cy - span);
      ctx.lineTo(cx + d + off + span, cy + span);
      ctx.moveTo(cx + d + off + span, cy - span);
      ctx.lineTo(cx + d + off - span, cy + span);
    }
    ctx.stroke();
  }
  // Specular highlight and rim shadow sell the curvature.
  glow(ctx, cx - rx * 0.32, cy - ry * 0.42, Math.min(rx, ry) * 0.55, "rgba(255,255,255,0.9)", 0.5);
  ctx.restore();
}

/** Handheld dynamic mic in a stand clip, with a Studio 26 mic flag — like a TV/radio mic. */
function paintMicOnStand(ctx: Ctx, w: number, h: number, a: SceneAssets) {
  const s = Math.min(w, h);
  const cx = w * 0.5;
  const ballY = h * 0.6;
  const r = s * 0.078;
  const tilt = 0.1;
  const clipLocal = r * 3.15;
  const clipX = cx - Math.sin(tilt) * clipLocal;
  const clipY = ballY + Math.cos(tilt) * clipLocal;

  // Soft contact shadow so the mic sits in the scene rather than floating on it.
  ctx.save();
  glow(ctx, cx, ballY + r * 1.6, r * 3.2, "rgba(0,0,0,0.9)", 0.28);

  // Stand pole, straight down from the clip.
  const poleW = s * 0.018;
  ctx.fillStyle = chromeGradient(ctx, clipX - poleW / 2, clipX + poleW / 2);
  ctx.fillRect(clipX - poleW / 2, clipY, poleW, h - clipY + 2);
  // Swivel knob at the top of the pole.
  ctx.fillStyle = "#0c0c0f";
  roundRect(ctx, clipX - poleW * 1.3, clipY - poleW * 0.2, poleW * 2.6, poleW * 1.6, poleW * 0.5);
  ctx.fill();

  ctx.translate(cx, ballY);
  ctx.rotate(tilt);

  // Handle: tapered matte black body with a soft vertical highlight.
  const topW = r * 1.1;
  const botW = r * 0.66;
  const topY = r * 0.75;
  const botY = r * 3.9;
  const body = ctx.createLinearGradient(-topW / 2, 0, topW / 2, 0);
  body.addColorStop(0, "#040405");
  body.addColorStop(0.3, "#34353a");
  body.addColorStop(0.42, "#55565c");
  body.addColorStop(0.6, "#141417");
  body.addColorStop(1, "#020203");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-topW / 2, topY);
  ctx.lineTo(topW / 2, topY);
  ctx.lineTo(botW / 2, botY);
  ctx.quadraticCurveTo(0, botY + botW * 0.35, -botW / 2, botY);
  ctx.closePath();
  ctx.fill();

  // Stand clip around the lower handle.
  ctx.fillStyle = "#0a0a0c";
  roundRect(ctx, -r * 0.62, clipLocal - r * 0.32, r * 1.24, r * 0.56, r * 0.12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = Math.max(1, r * 0.03);
  ctx.stroke();

  // Mic flag — the cube with the station logo — wrapped around the handle.
  const fw = r * 2.5;
  const fh = r * 1.25;
  const fy = r * 1.2;
  const flag = ctx.createLinearGradient(-fw / 2, 0, fw / 2, 0);
  flag.addColorStop(0, "#08080b");
  flag.addColorStop(0.45, "#1f1f26");
  flag.addColorStop(1, "#070709");
  ctx.fillStyle = flag;
  roundRect(ctx, -fw / 2, fy, fw, fh, r * 0.16);
  ctx.fill();
  // Top face of the cube, catching the stage light.
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  roundRect(ctx, -fw / 2, fy, fw, fh * 0.1, r * 0.16);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.strokeStyle = rainbowStroke(ctx, 0, fy + fh / 2);
  roundRect(ctx, -fw / 2, fy, fw, fh, r * 0.16);
  ctx.stroke();
  if (a.mark) {
    const m = fh * 0.86;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, fy + fh / 2, m / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(a.mark, -m / 2, fy + fh / 2 - m / 2, m, m);
    ctx.restore();
  }

  // Chrome band where the grille meets the body.
  ctx.fillStyle = chromeGradient(ctx, -topW * 0.62, topW * 0.62);
  roundRect(ctx, -topW * 0.62, r * 0.62, topW * 1.24, r * 0.28, r * 0.08);
  ctx.fill();

  // The ball grille.
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 1.04, 0, 0, Math.PI * 2);
  meshGrille(ctx, 0, 0, r, r * 1.04);
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 1.04, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();
  ctx.restore();
}

/** Large-diaphragm studio condenser in a shock mount, hung off a boom arm from the side. */
function paintCondenserMic(ctx: Ctx, w: number, h: number, a: SceneAssets) {
  const s = Math.min(w, h);
  const cx = w * 0.5;
  const top = h * 0.565;
  const cw = s * 0.16;
  const ch = s * 0.46;
  const grilleH = ch * 0.5;
  const mountY = top + ch * 0.66;
  const ringRx = cw * 0.98;
  const ringRy = cw * 0.26;

  ctx.save();
  glow(ctx, cx, top + ch * 0.5, cw * 2.2, "rgba(0,0,0,0.9)", 0.3);

  // Boom arm from the lower right edge up to the mount.
  const armW = s * 0.022;
  ctx.strokeStyle = "#0b0b0e";
  ctx.lineCap = "round";
  ctx.lineWidth = armW;
  ctx.beginPath();
  ctx.moveTo(cx + ringRx * 1.02, mountY);
  ctx.lineTo(cx + ringRx * 1.5, mountY + s * 0.04);
  ctx.lineTo(w + armW, h * 0.98);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = Math.max(1, armW * 0.18);
  ctx.beginPath();
  ctx.moveTo(cx + ringRx * 1.5, mountY + s * 0.04 - armW * 0.3);
  ctx.lineTo(w + armW, h * 0.98 - armW * 0.3);
  ctx.stroke();

  // Back half of the shock-mount ring, behind the body.
  ctx.lineWidth = Math.max(2, s * 0.012);
  ctx.strokeStyle = "#141418";
  ctx.beginPath();
  ctx.ellipse(cx, mountY, ringRx, ringRy, 0, Math.PI, Math.PI * 2);
  ctx.stroke();

  // Body (lower part): satin black with a gold logo badge.
  const body = ctx.createLinearGradient(cx - cw / 2, 0, cx + cw / 2, 0);
  body.addColorStop(0, "#050506");
  body.addColorStop(0.28, "#2e2f35");
  body.addColorStop(0.4, "#4a4b52");
  body.addColorStop(0.62, "#131317");
  body.addColorStop(1, "#030304");
  ctx.fillStyle = body;
  roundRect(ctx, cx - cw / 2, top + grilleH * 0.6, cw, ch - grilleH * 0.6, cw * 0.18);
  ctx.fill();
  if (a.mark) {
    const m = cw * 0.42;
    const my = top + grilleH + (ch - grilleH) * 0.14;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, my + m / 2, m / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(a.mark, cx - m / 2, my, m, m);
    ctx.restore();
  }

  // Grille (upper part): a capsule-shaped mesh head with a center seam and two trim bands.
  roundRect(ctx, cx - cw / 2, top, cw, grilleH, cw / 2);
  meshGrille(ctx, cx, top + grilleH * 0.45, cw / 2, grilleH / 2);
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(1, cw * 0.025);
  roundRect(ctx, cx - cw / 2, top, cw, grilleH, cw / 2);
  ctx.stroke();
  ctx.fillStyle = chromeGradient(ctx, cx - cw / 2, cx + cw / 2);
  ctx.fillRect(cx - cw / 2, top + grilleH - cw * 0.06, cw, cw * 0.08);
  ctx.fillStyle = "rgba(20,20,24,0.55)";
  ctx.fillRect(cx - cw * 0.012, top + cw * 0.08, cw * 0.024, grilleH - cw * 0.14);

  // Front half of the ring + elastic suspension bands.
  ctx.lineWidth = Math.max(2, s * 0.012);
  ctx.strokeStyle = "#1c1c21";
  ctx.beginPath();
  ctx.ellipse(cx, mountY, ringRx, ringRy, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = Math.max(1, s * 0.003);
  ctx.beginPath();
  ctx.ellipse(cx, mountY - ringRy * 0.15, ringRx, ringRy, 0, 0.15, Math.PI - 0.15);
  ctx.stroke();
  ctx.strokeStyle = "rgba(10,10,12,0.9)";
  ctx.lineWidth = Math.max(1, s * 0.004);
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(cx + side * cw * 0.5, mountY - ch * 0.08);
    ctx.lineTo(cx + side * ringRx * 0.86, mountY + ringRy * 0.4);
    ctx.moveTo(cx + side * cw * 0.5, mountY + ch * 0.08);
    ctx.lineTo(cx + side * ringRx * 0.86, mountY - ringRy * 0.4);
  }
  ctx.stroke();
  ctx.restore();
}

// ─── Scenes ──────────────────────────────────────────────────────────────────────────────────────

/** Studio 26's own backdrop: a black "screen" with the wordmark softly out of focus behind you. */
function paintBrand(ctx: Ctx, w: number, h: number, a: SceneAssets) {
  const s = Math.min(w, h);
  ctx.fillStyle = "#040406";
  ctx.fillRect(0, 0, w, h);
  // A dim, lit-from-the-front backdrop: barely-there charcoal in the middle falling off to black.
  const lit = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.75);
  lit.addColorStop(0, "#1a1920");
  lit.addColorStop(0.55, "#0b0b0f");
  lit.addColorStop(1, "#030304");
  ctx.fillStyle = lit;
  ctx.fillRect(0, 0, w, h);

  // The speaker mark, huge and deeply out of focus, centered behind the singer: its rainbow ring
  // peeks out around the head and shoulders like a halo.
  if (a.mark) {
    const m = s * 1.12;
    soft(ctx, w, h, 7, 0.5, (c) => c.drawImage(a.mark!, w / 2 - m / 2, h * 0.47 - m / 2, m, m));
  } else {
    soft(ctx, w, h, 7, 0.45, (c) => {
      c.lineWidth = s * 0.05;
      c.strokeStyle = rainbowStroke(c, w / 2, h * 0.47);
      c.beginPath();
      c.arc(w / 2, h * 0.47, s * 0.42, 0, Math.PI * 2);
      c.stroke();
    });
  }

  // The wordmark across the top, slightly out of focus — like a printed backdrop just past the
  // camera's depth of field — with a faint sharp pass over it so it still reads at a glance.
  if (a.wordmark) {
    const ww = Math.min(w * 0.84, h * 0.75);
    const wh = (ww * a.wordmark.height) / a.wordmark.width;
    const wx = (w - ww) / 2;
    const wy = h * 0.055;
    soft(ctx, w, h, 2.6, 0.9, (c) => c.drawImage(a.wordmark!, wx, wy, ww, wh));
    ctx.globalAlpha = 0.22;
    ctx.drawImage(a.wordmark, wx, wy, ww, wh);
    ctx.globalAlpha = 1;
  }

  // Floor fade + vignette to keep the edges calm and the singer the brightest thing in frame.
  const floor = ctx.createLinearGradient(0, h * 0.75, 0, h);
  floor.addColorStop(0, "rgba(0,0,0,0)");
  floor.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = floor;
  ctx.fillRect(0, h * 0.75, w, h * 0.25);
  vignette(ctx, w, h, 0.65);
}

function paintStudio(ctx: Ctx, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#2a2e37");
  bg.addColorStop(1, "#101217");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.22, h * 0.16, w * 0.6, "#f5f0e6", 0.22);
  glow(ctx, w * 0.82, h * 0.28, w * 0.55, brandColor("teal"), 0.16);
  // Seamless paper backdrop curve where the wall meets the floor.
  const sweep = ctx.createLinearGradient(0, h * 0.7, 0, h);
  sweep.addColorStop(0, "rgba(255,255,255,0)");
  sweep.addColorStop(0.5, "rgba(255,255,255,0.05)");
  sweep.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
  vignette(ctx, w, h, 0.45);
}

/** A theatre stage: red velvet curtains framing a single spotlight on a wooden floor. */
function paintStage(ctx: Ctx, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0c0d12");
  bg.addColorStop(0.7, "#15161d");
  bg.addColorStop(1, "#2b1d14");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(w * 0.5, -h * 0.05);
  ctx.lineTo(w * 0.12, h * 0.85);
  ctx.lineTo(w * 0.88, h * 0.85);
  ctx.closePath();
  ctx.clip();
  glow(ctx, w * 0.5, h * 0.1, Math.max(w, h) * 0.9, "#fff3d6", 0.3);
  ctx.restore();
  // Pool of light on the floor.
  ctx.save();
  ctx.translate(w / 2, h * 0.86);
  ctx.scale(1, 0.22);
  glow(ctx, 0, 0, w * 0.4, "#fff0cc", 0.45);
  ctx.restore();

  const floor = ctx.createLinearGradient(0, h * 0.8, 0, h);
  floor.addColorStop(0, "transparent");
  floor.addColorStop(1, "#3a2515");
  ctx.fillStyle = floor;
  ctx.fillRect(0, h * 0.8, w, h * 0.2);

  // Velvet curtains: folds are just a repeating light/dark gradient across each drape.
  const drape = (x0: number, x1: number) => {
    const folds = 5;
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    for (let i = 0; i <= folds * 2; i++) {
      g.addColorStop(i / (folds * 2), i % 2 === 0 ? "#3d0710" : "#8c1426");
    }
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, x1 - x0, h);
    const shade = ctx.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, "rgba(0,0,0,0.55)");
    shade.addColorStop(0.4, "rgba(0,0,0,0.1)");
    shade.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = shade;
    ctx.fillRect(x0, 0, x1 - x0, h);
  };
  drape(0, w * 0.16);
  drape(w * 0.84, w);
  // Valance across the top.
  const val = ctx.createLinearGradient(0, 0, 0, h * 0.09);
  val.addColorStop(0, "#2a050b");
  val.addColorStop(1, "#7a1122");
  ctx.fillStyle = val;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h * 0.07);
  const scallops = 6;
  for (let i = scallops; i > 0; i--) {
    const x1 = (w * (i - 1)) / scallops;
    const xm = (w * (i - 0.5)) / scallops;
    ctx.quadraticCurveTo(xm, h * 0.11, x1, h * 0.07);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#d4a24c";
  ctx.fillRect(0, h * 0.065, w, Math.max(1, h * 0.004));
  vignette(ctx, w, h, 0.4);
}

// Arena: a crowd seen from far back, with sweeping beams in the brand colors.
const arenaRigs = memoBySize((w, h): BeamRig[] => {
  const cols = [brandColor("coral"), brandColor("gold"), brandColor("teal"), brandColor("indigo")];
  return [0.12, 0.38, 0.62, 0.88].map((xf, i) => ({
    x: w * xf,
    y: -h * 0.02,
    color: cols[i],
    base: (0.5 - xf) * 0.6,
    swing: 0.38,
    speed: 0.55 + i * 0.12,
    phase: i * 1.7,
  }));
});

function paintArena(ctx: Ctx, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#08080d");
  bg.addColorStop(1, "#141018");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.5, h * 0.05, w * 0.7, "#ffffff", 0.18);
  // Haze band where the beams cross.
  glow(ctx, w * 0.5, h * 0.55, Math.max(w, h) * 0.6, "#3a2a55", 0.35);
  ctx.fillStyle = "rgba(5,5,8,0.88)";
  const rows = 3;
  for (let r = 0; r < rows; r++) {
    const rowY = h * (0.86 + r * 0.045);
    const radius = w * (0.028 - r * 0.003);
    const count = Math.ceil(w / (radius * 1.7)) + 1;
    for (let i = 0; i < count; i++) {
      const jitter = ((i * 37 + r * 13) % 10) / 10 - 0.5;
      const x = i * radius * 1.7 + (r % 2 === 0 ? radius * 0.85 : 0);
      ctx.beginPath();
      ctx.ellipse(x, rowY + jitter * radius * 0.4, radius, radius * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillRect(0, h * 0.95, w, h * 0.05);
}

function animateArena(ctx: Ctx, w: number, h: number, t: number) {
  drawBeams(ctx, w, h, arenaRigs(w, h), t, 0.22);
}

interface CrowdHead {
  x: number;
  y: number;
  r: number;
  t: number;
}
interface CrowdArm {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  t: number;
}
interface CrowdLayout {
  heads: CrowdHead[];
  arms: CrowdArm[];
  lights: Twinkle[];
}

function buildCrowd(
  w: number,
  h: number,
  opts: {
    seed: number;
    rows: number;
    y0: number;
    y1: number;
    r0: number;
    r1: number;
    armChance: number;
    phoneChance: number;
  },
): CrowdLayout {
  const s = Math.min(w, h);
  const rng = mulberry32(opts.seed);
  const heads: CrowdHead[] = [];
  const arms: CrowdArm[] = [];
  const lights: Twinkle[] = [];
  for (let row = 0; row < opts.rows; row++) {
    const t = row / (opts.rows - 1);
    const y = h * (opts.y0 + t * (opts.y1 - opts.y0));
    const r = s * (opts.r0 + t * (opts.r1 - opts.r0));
    const spacing = r * 1.9;
    const count = Math.ceil(w / spacing) + 2;
    for (let i = 0; i < count; i++) {
      const x = (i - 0.5) * spacing + (row % 2) * spacing * 0.5 + (rng() - 0.5) * r * 0.7;
      const yy = y + (rng() - 0.5) * r * 0.6;
      heads.push({ x, y: yy, r, t });
      if (rng() < opts.armChance) {
        const x1 = x + (rng() - 0.5) * r * 1.6;
        const y1 = yy - r * (2.2 + rng() * 1.3);
        arms.push({
          x0: x + (rng() - 0.5) * r * 0.6,
          y0: yy + r * 0.2,
          x1,
          y1,
          width: r * 0.34,
          t,
        });
        if (rng() < opts.phoneChance) {
          lights.push({
            x: x1,
            y: y1 - r * 0.25,
            r: r * (1.5 + rng() * 0.9),
            phase: rng() * Math.PI * 2,
            speed: 1.2 + rng() * 2.4,
          });
        }
      }
    }
  }
  return { heads, arms, lights };
}

function paintCrowdLayout(
  ctx: Ctx,
  layout: CrowdLayout,
  far: [number, number, number],
  near: [number, number, number],
  rim: string,
) {
  const mix = (t: number) =>
    `rgb(${Math.round(far[0] + (near[0] - far[0]) * t)},${Math.round(far[1] + (near[1] - far[1]) * t)},${Math.round(far[2] + (near[2] - far[2]) * t)})`;
  // Draw row by row (heads are already ordered far → near), arms of a row before that row's heads
  // so closer people overlap the hands of those behind them.
  let ai = 0;
  let hi = 0;
  const { heads, arms } = layout;
  ctx.lineCap = "round";
  while (hi < heads.length) {
    const t = heads[hi].t;
    const color = mix(t);
    while (ai < arms.length && arms[ai].t === t) {
      const a = arms[ai++];
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, a.width);
      ctx.beginPath();
      ctx.moveTo(a.x0, a.y0);
      ctx.lineTo(a.x1, a.y1);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(a.x1, a.y1, a.width * 0.75, a.width, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    while (hi < heads.length && heads[hi].t === t) {
      const p = heads[hi++];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 0.72, p.r * 0.86, 0, 0, Math.PI * 2);
      ctx.fill();
      // Shoulders.
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + p.r * 1.55, p.r * 1.25, p.r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      // Rim light from the stage, fading with distance.
      ctx.strokeStyle = rim;
      ctx.globalAlpha = 0.35 * (1 - t * 0.6);
      ctx.lineWidth = Math.max(0.6, p.r * 0.1);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 0.72, p.r * 0.86, 0, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // The phones themselves — tiny bright screens under each twinkle.
  ctx.fillStyle = "rgba(235,245,255,0.9)";
  for (const l of layout.lights) {
    const pw = Math.max(1, l.r * 0.07);
    ctx.fillRect(l.x - pw / 2, l.y - pw * 0.9, pw, pw * 1.8);
  }
}

/** A selfie held up in the middle of a packed crowd — close, warm, everyone's phone up. */
const crowdLayout = memoBySize((w, h) =>
  buildCrowd(w, h, {
    seed: 7,
    rows: 7,
    y0: 0.42,
    y1: 1.02,
    r0: 0.03,
    r1: 0.1,
    armChance: 0.32,
    phoneChance: 0.75,
  }),
);

function paintCrowd(ctx: Ctx, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#140b1c");
  bg.addColorStop(0.5, "#251531");
  bg.addColorStop(1, "#08060c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.5, h * 0.05, Math.max(w, h) * 0.8, "#ffdca8", 0.32);
  glow(ctx, w * 0.14, h * 0.22, w * 0.5, brandColor("coral"), 0.2);
  glow(ctx, w * 0.88, h * 0.24, w * 0.5, brandColor("indigo"), 0.22);
  paintCrowdLayout(ctx, crowdLayout(w, h), [62, 42, 78], [10, 7, 16], "#ffdcb0");
  vignette(ctx, w, h, 0.4);
}

function animateCrowd(ctx: Ctx, w: number, h: number, t: number) {
  drawTwinkles(ctx, crowdLayout(w, h).lights, t);
}

/** From the stage looking out: a packed hall, side screens with the logo, beams sweeping overhead. */
const micStageLayout = memoBySize((w, h) =>
  buildCrowd(w, h, {
    seed: 26,
    rows: 9,
    y0: 0.4,
    y1: 0.98,
    r0: 0.014,
    r1: 0.06,
    armChance: 0.26,
    phoneChance: 0.7,
  }),
);
const micStageRigs = memoBySize((w, h): BeamRig[] => {
  const cols = [brandColor("coral"), "#b25cff", brandColor("teal"), brandColor("gold"), "#3d7bff"];
  return [0.08, 0.3, 0.5, 0.7, 0.92].map((xf, i) => ({
    x: w * xf,
    y: h * 0.07,
    color: cols[i],
    base: (xf - 0.5) * 1.1,
    swing: 0.32,
    speed: 0.45 + i * 0.13,
    phase: i * 2.1,
  }));
});

function paintMicStage(ctx: Ctx, w: number, h: number, a: SceneAssets) {
  const s = Math.min(w, h);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#050409");
  bg.addColorStop(0.45, "#1a1030");
  bg.addColorStop(1, "#07050c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // Haze at the back of the hall, lit by the house lights.
  glow(ctx, w * 0.5, h * 0.42, Math.max(w, h) * 0.65, "#7a4cc2", 0.35);
  glow(ctx, w * 0.25, h * 0.38, s * 0.6, brandColor("coral"), 0.18);
  glow(ctx, w * 0.78, h * 0.36, s * 0.6, brandColor("teal"), 0.2);

  // Side LED screens showing the logo.
  for (const side of [-1, 1]) {
    const sw = s * 0.34;
    const sh = sw * 0.62;
    const sx = side < 0 ? w * 0.03 : w * 0.97 - sw;
    const sy = h * 0.17;
    ctx.save();
    ctx.shadowColor = "rgba(150,110,255,0.6)";
    ctx.shadowBlur = s * 0.06;
    ctx.fillStyle = "#06060a";
    roundRect(ctx, sx, sy, sw, sh, s * 0.008);
    ctx.fill();
    ctx.restore();
    const scr = ctx.createRadialGradient(
      sx + sw / 2,
      sy + sh / 2,
      0,
      sx + sw / 2,
      sy + sh / 2,
      sw * 0.7,
    );
    scr.addColorStop(0, "#2b1d4d");
    scr.addColorStop(1, "#0b0814");
    ctx.fillStyle = scr;
    ctx.fillRect(sx + 2, sy + 2, sw - 4, sh - 4);
    if (a.mark) {
      const m = sh * 0.84;
      ctx.drawImage(a.mark, sx + sw / 2 - m / 2, sy + sh / 2 - m / 2, m, m);
    }
    // Scanline texture.
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let y = sy + 2; y < sy + sh - 2; y += 3) ctx.fillRect(sx + 2, y, sw - 4, 1);
  }

  // Lighting truss across the top with a row of lamps.
  ctx.fillStyle = "#0d0d12";
  ctx.fillRect(0, h * 0.05, w, h * 0.035);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x += s * 0.04) {
    ctx.moveTo(x, h * 0.05);
    ctx.lineTo(x + s * 0.04, h * 0.085);
  }
  ctx.stroke();
  const lamps = 9;
  for (let i = 0; i < lamps; i++) {
    const lx = ((i + 0.5) / lamps) * w;
    glow(ctx, lx, h * 0.09, s * 0.07, "#fff2d8", 0.9);
  }

  paintCrowdLayout(ctx, micStageLayout(w, h), [70, 48, 104], [8, 6, 13], "#ffc9e6");
  // Stage edge: a band of warm footlights just in front of the front row.
  const edge = ctx.createLinearGradient(0, h * 0.93, 0, h);
  edge.addColorStop(0, "rgba(255,190,120,0)");
  edge.addColorStop(0.4, "rgba(255,190,120,0.18)");
  edge.addColorStop(1, "rgba(10,8,12,0.95)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, h * 0.93, w, h * 0.07);
  vignette(ctx, w, h, 0.45);
}

function animateMicStage(ctx: Ctx, w: number, h: number, t: number) {
  drawBeams(ctx, w, h, micStageRigs(w, h), t, 0.2);
  drawTwinkles(ctx, micStageLayout(w, h).lights, t);
}

/** A treated vocal booth: acoustic foam walls, a warm lamp and a glowing ON AIR sign. */
function paintMicBooth(ctx: Ctx, w: number, h: number) {
  const s = Math.min(w, h);
  ctx.fillStyle = "#121318";
  ctx.fillRect(0, 0, w, h);
  // Foam panels: each tile is a set of wedges, alternating direction like real acoustic foam.
  const tile = s * 0.14;
  const ridges = 4;
  for (let ty = 0, row = 0; ty < h; ty += tile, row++) {
    for (let tx = 0, col = 0; tx < w; tx += tile, col++) {
      const vertical = (row + col) % 2 === 0;
      const g = vertical
        ? ctx.createLinearGradient(tx, 0, tx + tile, 0)
        : ctx.createLinearGradient(0, ty, 0, ty + tile);
      for (let i = 0; i <= ridges * 2; i++) {
        g.addColorStop(i / (ridges * 2), i % 2 === 0 ? "#0b0c10" : "#272932");
      }
      ctx.fillStyle = g;
      ctx.fillRect(tx + 1, ty + 1, tile - 2, tile - 2);
    }
  }
  // Warm practical lamp, cool indigo LED wash from below.
  glow(ctx, w * 0.18, h * 0.2, s * 0.75, "#ffb36b", 0.35);
  glow(ctx, w * 0.5, h * 1.02, Math.max(w, h) * 0.7, brandColor("indigo"), 0.55);
  glow(ctx, w * 0.9, h * 0.6, s * 0.5, brandColor("teal"), 0.18);

  // ON AIR sign, top right.
  const sw = s * 0.3;
  const sh = sw * 0.36;
  const sx = w * 0.95 - sw;
  const sy = h * 0.07;
  ctx.save();
  ctx.shadowColor = "rgba(255,40,60,0.85)";
  ctx.shadowBlur = s * 0.07;
  ctx.fillStyle = "#3a0710";
  roundRect(ctx, sx, sy, sw, sh, sh * 0.18);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#ff4d5e";
  ctx.lineWidth = Math.max(1, s * 0.004);
  roundRect(ctx, sx, sy, sw, sh, sh * 0.18);
  ctx.stroke();
  ctx.save();
  ctx.fillStyle = "#ffe6e8";
  ctx.shadowColor = "#ff2d45";
  ctx.shadowBlur = s * 0.025;
  ctx.font = `800 ${Math.round(sh * 0.56)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ON AIR", sx + sw / 2, sy + sh / 2 + sh * 0.03);
  ctx.restore();
  vignette(ctx, w, h, 0.55);
}

/** Exposed brick wall with neon signs: the logo's rainbow ring and a music note. */
function paintNeon(ctx: Ctx, w: number, h: number) {
  const s = Math.min(w, h);
  ctx.fillStyle = "#1d0f10";
  ctx.fillRect(0, 0, w, h);
  const rng = mulberry32(11);
  const bw = s * 0.13;
  const bh = bw * 0.36;
  for (let y = 0, row = 0; y < h; y += bh, row++) {
    for (let x = row % 2 ? -bw / 2 : 0; x < w; x += bw) {
      const v = rng();
      ctx.fillStyle = `rgb(${Math.round(52 + v * 30)},${Math.round(24 + v * 12)},${Math.round(22 + v * 10)})`;
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
    }
  }
  // Darken the wall overall so the neon carries the light.
  ctx.fillStyle = "rgba(6,4,10,0.62)";
  ctx.fillRect(0, 0, w, h);

  const neon = (draw: () => void, color: string, width: number) => {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = color;
    for (const [blur, lw, stroke] of [
      [s * 0.08, width * 2.2, color],
      [s * 0.03, width * 1.3, color],
      [0, width * 0.45, "#ffffff"],
    ] as const) {
      ctx.shadowBlur = blur;
      ctx.lineWidth = lw;
      ctx.strokeStyle = stroke;
      draw();
      ctx.stroke();
    }
    ctx.restore();
  };

  // Rainbow ring, upper left — drawn as colored arc segments so each segment glows its own color.
  const rcx = w * 0.24;
  const rcy = h * 0.2;
  const rr = s * 0.14;
  const seg = RAINBOW.length - 1;
  for (let i = 0; i < seg; i++) {
    const a0 = -Math.PI / 2 + (i / seg) * Math.PI * 2 + 0.04;
    const a1 = -Math.PI / 2 + ((i + 1) / seg) * Math.PI * 2 - 0.04;
    neon(
      () => {
        ctx.beginPath();
        ctx.arc(rcx, rcy, rr, a0, a1);
      },
      RAINBOW[i],
      s * 0.012,
    );
  }
  // "26" inside the ring.
  ctx.save();
  ctx.font = `italic 900 ${Math.round(rr * 0.9)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#ff4fa3";
  ctx.shadowBlur = s * 0.05;
  ctx.lineWidth = s * 0.008;
  ctx.strokeStyle = "#ff4fa3";
  ctx.strokeText("26", rcx, rcy + rr * 0.04);
  ctx.shadowBlur = 0;
  ctx.lineWidth = s * 0.003;
  ctx.strokeStyle = "#ffe3f1";
  ctx.strokeText("26", rcx, rcy + rr * 0.04);
  ctx.restore();

  // Music note, upper right.
  const nx = w * 0.8;
  const ny = h * 0.12;
  const nh = s * 0.22;
  neon(
    () => {
      ctx.beginPath();
      ctx.moveTo(nx - nh * 0.25, ny + nh * 0.85);
      ctx.lineTo(nx - nh * 0.25, ny);
      ctx.lineTo(nx + nh * 0.3, ny - nh * 0.12);
      ctx.lineTo(nx + nh * 0.3, ny + nh * 0.72);
      ctx.moveTo(nx - nh * 0.25, ny + nh * 0.14);
      ctx.lineTo(nx + nh * 0.3, ny + nh * 0.02);
      ctx.moveTo(nx - nh * 0.25 + nh * 0.13, ny + nh * 0.85);
      ctx.ellipse(nx - nh * 0.38, ny + nh * 0.85, nh * 0.13, nh * 0.1, -0.35, 0, Math.PI * 2);
      ctx.moveTo(nx + nh * 0.3 + nh * 0.13, ny + nh * 0.72);
      ctx.ellipse(nx + nh * 0.17, ny + nh * 0.72, nh * 0.13, nh * 0.1, -0.35, 0, Math.PI * 2);
    },
    "#36e2ff",
    s * 0.01,
  );

  // Colored light spilling onto the wall.
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, rcx, rcy, s * 0.5, "#ff3d8b", 0.12);
  glow(ctx, nx, ny + nh * 0.4, s * 0.45, "#2fc8ff", 0.12);
  ctx.globalCompositeOperation = "source-over";
  vignette(ctx, w, h, 0.5);
}

/** Rooftop at night: city skyline with lit windows and out-of-focus bokeh lights. */
function paintCity(ctx: Ctx, w: number, h: number) {
  const s = Math.min(w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.75);
  sky.addColorStop(0, "#070b1f");
  sky.addColorStop(0.55, "#1e1846");
  sky.addColorStop(1, "#5a2a5e");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const rng = mulberry32(5);
  // Two skyline layers: hazy far towers, then darker near ones with windows.
  for (const [layer, base, maxH, color, windows] of [
    [0, h * 0.72, h * 0.42, "#231c44", false],
    [1, h * 0.8, h * 0.5, "#0d0b1c", true],
  ] as const) {
    let x = -s * 0.05;
    while (x < w) {
      const bw = s * (0.08 + rng() * 0.12);
      const bh = maxH * (0.35 + rng() * 0.65) * (layer === 0 ? 1 : 0.9);
      ctx.fillStyle = color;
      ctx.fillRect(x, base - bh, bw - 1, h - base + bh);
      if (windows) {
        const wsz = Math.max(1.5, s * 0.008);
        for (let wy = base - bh + wsz * 2; wy < base; wy += wsz * 2.6) {
          for (let wx = x + wsz; wx < x + bw - wsz * 2; wx += wsz * 2.2) {
            if (rng() < 0.38) {
              ctx.fillStyle = rng() < 0.75 ? "rgba(255,214,140,0.85)" : "rgba(150,210,255,0.8)";
              ctx.fillRect(wx, wy, wsz, wsz * 1.3);
            }
          }
        }
      }
      x += bw;
    }
  }
  // Big soft bokeh discs — the city lights way out of focus.
  soft(ctx, w, h, 4, 0.9, (c) => {
    const r2 = mulberry32(9);
    for (let i = 0; i < 22; i++) {
      const bx = r2() * w;
      const by = h * (0.35 + r2() * 0.45);
      const br = s * (0.025 + r2() * 0.05);
      const hue = r2();
      c.fillStyle =
        hue < 0.5
          ? "rgba(255,190,110,0.45)"
          : hue < 0.8
            ? "rgba(255,110,170,0.38)"
            : "rgba(120,190,255,0.38)";
      c.beginPath();
      c.arc(bx, by, br, 0, Math.PI * 2);
      c.fill();
    }
  });
  // Rooftop railing.
  const rail = h * 0.83;
  ctx.fillStyle = "#06060c";
  ctx.fillRect(0, rail, w, h - rail);
  ctx.fillStyle = "#1b1b26";
  ctx.fillRect(0, rail - s * 0.012, w, s * 0.012);
  for (let x = 0; x < w; x += s * 0.06) ctx.fillRect(x, rail, Math.max(1, s * 0.006), h - rail);
  glow(ctx, w * 0.5, h * 0.75, Math.max(w, h) * 0.6, "#ff7ab6", 0.12);
  vignette(ctx, w, h, 0.4);
}

function paintCaesarea(ctx: Ctx, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.58);
  sky.addColorStop(0, "#251534");
  sky.addColorStop(0.55, "#7a3b52");
  sky.addColorStop(1, "#d9814f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.58);
  // A few early stars.
  const rng = mulberry32(3);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  for (let i = 0; i < 26; i++) {
    const r = Math.max(0.6, Math.min(w, h) * 0.002 * rng());
    ctx.fillRect(rng() * w, rng() * h * 0.28, r, r);
  }

  const sea = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.62);
  sea.addColorStop(0, "#d9814f");
  sea.addColorStop(1, "#11202c");
  ctx.fillStyle = sea;
  ctx.fillRect(0, h * 0.5, w, h * 0.13);
  // Sun glitter on the water.
  ctx.fillStyle = "rgba(255,214,160,0.35)";
  for (let i = 0; i < 18; i++) {
    const y = h * (0.52 + rng() * 0.08);
    const lw = w * (0.03 + rng() * 0.08);
    ctx.fillRect(w * 0.5 - lw / 2 + (rng() - 0.5) * w * 0.25, y, lw, 1);
  }

  const tierRows = 6;
  for (let r = 0; r < tierRows; r++) {
    const t = r / (tierRows - 1);
    const y = h * (0.6 + t * 0.375);
    const rowH = h * 0.075;
    const inset = w * 0.16 * (1 - t);
    ctx.fillStyle = `rgb(${28 + r * 4}, ${21 + r * 3}, ${16 + r * 2})`;
    ctx.fillRect(inset, y, w - inset * 2, rowH);
    ctx.fillStyle = "rgba(255,200,140,0.08)";
    ctx.fillRect(inset, y, w - inset * 2, Math.max(1, rowH * 0.08));
  }

  for (const tx of [w * 0.09, w * 0.91]) {
    ctx.fillStyle = "#0b0908";
    ctx.fillRect(tx - w * 0.008, h * 0.14, w * 0.016, h * 0.48);
    glow(ctx, tx, h * 0.14, w * 0.3, "#ffe3ac", 0.5);
  }
  glow(ctx, w * 0.5, h * 0.58, w * 0.65, "#ffd9a0", 0.28);
}

function paintBar(ctx: Ctx, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#1c130e");
  bg.addColorStop(1, "#090504");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.5, h * 0.1, w * 0.6, "#ffb35c", 0.4);
  // Pendant lamp cord + shade.
  ctx.fillStyle = "#0a0605";
  ctx.fillRect(w * 0.5 - 1, 0, 2, h * 0.08);
  ctx.beginPath();
  ctx.moveTo(w * 0.44, h * 0.11);
  ctx.lineTo(w * 0.56, h * 0.11);
  ctx.lineTo(w * 0.53, h * 0.08);
  ctx.lineTo(w * 0.47, h * 0.08);
  ctx.closePath();
  ctx.fill();
  glow(ctx, w * 0.5, h * 0.115, w * 0.08, "#ffe0a8", 0.9);

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

function fireplaceGeom(w: number, h: number) {
  const hearthW = w * 0.58;
  return { hearthW, hearthX: (w - hearthW) / 2, hearthY: h * 0.62, hearthH: h * 0.38 };
}

function paintFireplace(ctx: Ctx, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#2b1f16");
  bg.addColorStop(1, "#110b07");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const { hearthW, hearthX, hearthY, hearthH } = fireplaceGeom(w, h);
  ctx.fillStyle = "#3c2d20";
  ctx.fillRect(hearthX - w * 0.03, hearthY - h * 0.02, hearthW + w * 0.06, hearthH + h * 0.02);
  // Stone courses on the surround.
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;
  for (let y = hearthY; y < h; y += h * 0.035) {
    ctx.beginPath();
    ctx.moveTo(hearthX - w * 0.03, y);
    ctx.lineTo(hearthX + hearthW + w * 0.03, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#0c0502";
  ctx.fillRect(hearthX, hearthY, hearthW, hearthH);
  // Logs.
  ctx.fillStyle = "#2a160b";
  for (const [dx, rot] of [
    [-0.12, 0.12],
    [0.1, -0.1],
  ] as const) {
    ctx.save();
    ctx.translate(w * 0.5 + w * dx, hearthY + hearthH * 0.82);
    ctx.rotate(rot);
    roundRect(ctx, -hearthW * 0.22, -hearthH * 0.05, hearthW * 0.44, hearthH * 0.1, hearthH * 0.05);
    ctx.fill();
    ctx.restore();
  }
  glow(ctx, w * 0.5, h * 0.88, w * 0.9, "#ff7a3d", 0.18);
}

function animateFireplace(ctx: Ctx, w: number, h: number, t: number) {
  const { hearthW, hearthY, hearthH } = fireplaceGeom(w, h);
  const flicker =
    0.82 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1) + 0.08 * Math.sin(t * 13.7);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, w * 0.5, hearthY + hearthH * 0.6, w * 0.5, "#ff8a3d", 0.45 * flicker);
  glow(ctx, w * 0.5, h * 0.75, Math.max(w, h) * 0.6, "#ff7a3d", 0.12 * flicker);
  // Flame tongues swaying over the logs.
  const base = hearthY + hearthH * 0.8;
  const tongues = 6;
  for (let i = 0; i < tongues; i++) {
    const fx = w * 0.5 + (i / (tongues - 1) - 0.5) * hearthW * 0.62;
    const fw = hearthW * 0.085;
    const fh =
      hearthH *
      (0.32 + 0.14 * Math.sin(t * (3 + i * 0.7) + i * 1.9)) *
      (1 - Math.abs(i / (tongues - 1) - 0.5) * 0.7);
    const sway = Math.sin(t * (2.4 + i * 0.5) + i) * fw * 0.5;
    const g = ctx.createLinearGradient(0, base, 0, base - fh);
    g.addColorStop(0, "rgba(255,226,140,0.95)");
    g.addColorStop(0.4, "rgba(255,140,40,0.75)");
    g.addColorStop(1, "rgba(255,80,20,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(fx - fw, base);
    ctx.quadraticCurveTo(fx - fw * 0.9 + sway * 0.5, base - fh * 0.55, fx + sway, base - fh);
    ctx.quadraticCurveTo(fx + fw * 0.9 + sway * 0.5, base - fh * 0.55, fx + fw, base);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ─── Registry ────────────────────────────────────────────────────────────────────────────────────

type Painter = (ctx: Ctx, w: number, h: number, a: SceneAssets) => void;
type Animator = (ctx: Ctx, w: number, h: number, t: number) => void;

interface SceneDef {
  paint?: Painter;
  animate?: Animator;
  foreground?: Painter;
}

const flat =
  (color: () => string): Painter =>
  (ctx, w, h) => {
    ctx.fillStyle = color();
    ctx.fillRect(0, 0, w, h);
  };

const SCENES: Partial<Record<BackgroundId, SceneDef>> = {
  brand: { paint: paintBrand },
  micStage: { paint: paintMicStage, animate: animateMicStage, foreground: paintMicOnStand },
  micBooth: { paint: paintMicBooth, foreground: paintCondenserMic },
  arena: { paint: paintArena, animate: animateArena },
  crowd: { paint: paintCrowd, animate: animateCrowd },
  stage: { paint: paintStage },
  neon: { paint: paintNeon },
  city: { paint: paintCity },
  studio: { paint: paintStudio },
  caesarea: { paint: paintCaesarea },
  bar: { paint: paintBar },
  fireplace: { paint: paintFireplace, animate: animateFireplace },
  green: { paint: flat(() => "#12b350") },
  blue: { paint: flat(() => "#1565d8") },
  coral: { paint: flat(() => brandColor("coral")) },
  indigo: { paint: flat(() => brandColor("indigo")) },
  teal: { paint: flat(() => brandColor("teal")) },
  gold: { paint: flat(() => brandColor("gold")) },
};

export function getSceneDef(id: BackgroundId): SceneDef | undefined {
  return SCENES[id];
}

/**
 * A still of the scene with a neutral head-and-shoulders silhouette standing in for the singer —
 * for the picker tray, so each tile shows what you'll actually get (including where the mic sits).
 */
const thumbCache = new Map<string, Promise<string | null>>();
export function renderBackgroundThumbnail(
  id: BackgroundId,
  w: number,
  h: number,
): Promise<string | null> {
  const key = `${id}:${w}x${h}`;
  let p = thumbCache.get(key);
  if (!p) {
    p = (async () => {
      const def = SCENES[id];
      if (!def) return null;
      const assets = await loadSceneAssets();
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      def.paint?.(ctx, w, h, assets);
      def.animate?.(ctx, w, h, 1.3);
      // Silhouette.
      ctx.fillStyle = "rgba(24,24,30,0.94)";
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.4, w * 0.17, h * 0.115, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.86, w * 0.42, h * 0.26, 0, Math.PI, Math.PI * 2);
      ctx.lineTo(w * 0.92, h);
      ctx.lineTo(w * 0.08, h);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(w * 0.42, h * 0.48, w * 0.16, h * 0.14);
      def.foreground?.(ctx, w, h, assets);
      try {
        return c.toDataURL("image/jpeg", 0.86);
      } catch {
        return null;
      }
    })();
    thumbCache.set(key, p);
  }
  return p;
}
