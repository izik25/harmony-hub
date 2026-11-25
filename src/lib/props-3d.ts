/**
 * Real 3D face props (crown, party hat, sunglasses, masquerade mask, cat/bunny ears, mic) for the
 * selfie camera — the upgrade from face-filters.ts's flat 2D stickers. Each prop is modeled in
 * three.js with physically based materials (polished gold, glossy acetate, tinted glass, velvet,
 * plush) lit by a studio environment map, so it picks up real highlights and reflections. It's
 * posed with the full head rotation recovered from the face mesh — turn, nod and tilt — instead of
 * the 2D stickers' roll-only rotation, and an invisible head-shaped occluder hides whatever passes
 * behind the head (the back of the crown, the sunglasses' arms), which is most of what makes an
 * AR prop read as "on" the head rather than pasted over the picture.
 *
 * Geometry is built in code (no model files to download) in "face units": 1 = the distance between
 * the two cheek landmarks (~14cm on an adult), in a head frame whose x runs across the face, y up
 * the face and z out of it toward the camera, origin between the cheeks. Positions that should hug
 * a feature (lens over each eye, crown on the hairline, mic under the mouth) are read from that
 * face's own landmarks in the same frame every frame, so props fit each face rather than an average.
 *
 * The scene is drawn with an orthographic camera laid exactly over the video's pixel grid (x right,
 * y up = −image y, z toward the camera = −landmark z, all in pixels), so the pose comes straight
 * from MediaPipe's landmark coordinates with no camera calibration — and at selfie distance the
 * missing perspective isn't visible. One shared renderer (one WebGL context — phones run short of
 * them, and the segmenter already holds one) serves every caller; it's loaded lazily, so three.js
 * only downloads once someone actually picks a prop.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FilterKind } from "./face-filters";

// MediaPipe face-mesh landmark indices.
const CHEEK_R = 234;
const CHEEK_L = 454;
const FOREHEAD = 10;
const CHIN = 152;
const EYE_R_OUT = 33;
const EYE_R_IN = 133;
const EYE_L_OUT = 263;
const EYE_L_IN = 362;
const LIP_TOP = 13;
const LIP_BOTTOM = 14;
const NOSE_BRIDGE = 168;

export interface Props3DRenderer {
  /**
   * Renders `kind` posed on `face` into a transparent canvas the size of the video (`width` x
   * `height`) and returns it for the caller to drawImage straight away (it's only valid until the
   * next render). `scale` multiplies the prop's size — the gift player's pop-in. null when the
   * face is unusable or WebGL has gone away; callers fall back to the 2D sticker then.
   */
  render(
    face: NormalizedLandmark[],
    kind: FilterKind,
    width: number,
    height: number,
    scale?: number,
  ): HTMLCanvasElement | null;
}

let shared: Props3DRenderer | null | undefined;
/** The one shared renderer — null if this device can't do WebGL at all. */
export function getProps3DRenderer(): Props3DRenderer | null {
  if (shared === undefined) {
    try {
      shared = createRenderer();
    } catch (err) {
      console.error(err);
      shared = null;
    }
  }
  return shared;
}

// ---------------------------------------------------------------------------------------------
// Materials

function makeMaterials() {
  return {
    gold: new THREE.MeshPhysicalMaterial({
      color: 0xf2c25b,
      metalness: 1,
      roughness: 0.2,
      clearcoat: 0.4,
      clearcoatRoughness: 0.15,
    }),
    silver: new THREE.MeshPhysicalMaterial({ color: 0xd9dde3, metalness: 1, roughness: 0.28 }),
    pearl: new THREE.MeshPhysicalMaterial({
      color: 0xfbf6ee,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      sheen: 1,
      sheenColor: new THREE.Color(0xffe9f2),
    }),
    ruby: gem(0xd0103a),
    sapphire: gem(0x1747c8),
    emerald: gem(0x0f9a55),
    velvetRed: new THREE.MeshPhysicalMaterial({
      color: 0x4f0613,
      roughness: 0.9,
      sheen: 1,
      sheenRoughness: 0.4,
      sheenColor: new THREE.Color(0xc0283f),
    }),
    acetate: new THREE.MeshPhysicalMaterial({
      color: 0x0b0b0d,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    }),
    lens: new THREE.MeshPhysicalMaterial({
      color: 0x15131c,
      metalness: 0.35,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.9,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
    }),
    lacquer: new THREE.MeshPhysicalMaterial({
      color: 0x0d0a12,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
    }),
    furDark: new THREE.MeshPhysicalMaterial({
      color: 0x2a2626,
      roughness: 0.85,
      sheen: 1,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0x9a9090),
    }),
    furWhite: new THREE.MeshPhysicalMaterial({
      color: 0xf4f1ee,
      roughness: 0.9,
      sheen: 1,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xffffff),
    }),
    furPink: new THREE.MeshPhysicalMaterial({
      color: 0xf2a3b6,
      roughness: 0.75,
      sheen: 1,
      sheenRoughness: 0.4,
      sheenColor: new THREE.Color(0xffd6e0),
    }),
    rubber: new THREE.MeshPhysicalMaterial({ color: 0x141414, roughness: 0.55, clearcoat: 0.3 }),
    // Writes depth only: the invisible head that hides what goes behind it.
    occluder: new THREE.MeshBasicMaterial({ colorWrite: false }),
  };
}
type Materials = ReturnType<typeof makeMaterials>;

function gem(color: number) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    ior: 2.2,
    specularIntensity: 1,
    emissive: new THREE.Color(color).multiplyScalar(0.12),
  });
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

/** Bends a flat (x/y) geometry back around a vertical axis, so a mask or lens follows the face. */
function bend(geo: THREE.BufferGeometry, k: number) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, pos.getZ(i) - k * x * x);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function extrude(shape: THREE.Shape, depth: number, bevel: number, curveSegments = 24) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** Diagonal party stripes with a little glitter, for the hat's cone. */
function stripeTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  const colors = ["#ff4f6d", "#ffd34e", "#3fc1c9", "#8f5cff"];
  const band = 64;
  for (let i = -8; i < 16; i++) {
    g.fillStyle = colors[((i % 4) + 4) % 4];
    g.beginPath();
    g.moveTo(i * band, 0);
    g.lineTo(i * band + band, 0);
    g.lineTo(i * band + band - 512, 512);
    g.lineTo(i * band - 512, 512);
    g.closePath();
    g.fill();
  }
  for (let i = 0; i < 420; i++) {
    g.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.5})`;
    g.beginPath();
    g.arc(Math.random() * 512, Math.random() * 512, 0.8 + Math.random() * 1.6, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** A fine perforated-metal pattern for the mic grille, used as a bump map. */
function grilleTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#000";
  const step = 8;
  for (let y = 0; y < 256; y += step) {
    for (let x = (y / step) % 2 ? step / 2 : 0; x < 256; x += step) {
      g.beginPath();
      g.arc(x, y, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 3);
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Props — each built once, around its own natural origin (described per prop), in face units.

/** Origin: center of the crown's base ring, ring in the x/z plane, points up +y. */
function buildCrown(m: Materials) {
  const crown = new THREE.Group();
  const R = 0.5;
  // Band: a lathed profile with a rolled lower lip and a raised upper rim.
  const band = new THREE.LatheGeometry(
    [
      new THREE.Vector2(R - 0.012, 0),
      new THREE.Vector2(R + 0.012, 0),
      new THREE.Vector2(R + 0.022, 0.012),
      new THREE.Vector2(R + 0.016, 0.03),
      new THREE.Vector2(R + 0.012, 0.1),
      new THREE.Vector2(R + 0.022, 0.115),
      new THREE.Vector2(R + 0.014, 0.13),
      new THREE.Vector2(R - 0.012, 0.13),
    ],
    96,
  );
  crown.add(new THREE.Mesh(band, m.gold));

  // Velvet cap inside the band.
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(R - 0.01, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    m.velvetRed,
  );
  cap.scale.set(1, 0.62, 1);
  cap.position.y = 0.06;
  crown.add(cap);

  // Points: a fleur-like spike, tall and short alternating, each tipped with a pearl.
  const spike = (h: number) => {
    const w = 0.075;
    const s = new THREE.Shape();
    s.moveTo(-w, 0);
    s.quadraticCurveTo(-w * 0.25, h * 0.45, 0, h);
    s.quadraticCurveTo(w * 0.25, h * 0.45, w, 0);
    s.lineTo(-w, 0);
    return extrude(s, 0.014, 0.006);
  };
  const tall = spike(0.24);
  const short = spike(0.14);
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const isTall = i % 2 === 0;
    const h = isTall ? 0.24 : 0.14;
    const holder = new THREE.Group();
    holder.rotation.y = a;
    const p = new THREE.Mesh(isTall ? tall : short, m.gold);
    p.position.set(0, 0.125, R + 0.012);
    p.rotation.x = -0.08; // leans out a touch, like a real crown flares
    holder.add(p);
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(isTall ? 0.028 : 0.022, 20, 14), m.pearl);
    pearl.position.set(0, 0.125 + h + 0.012, R + 0.012 + Math.sin(0.08) * h);
    holder.add(pearl);
    // Gems around the band, the front one large.
    const front = i === 0;
    const gemMat = front ? m.ruby : i % 4 === 2 ? m.emerald : m.sapphire;
    const g = new THREE.Mesh(new THREE.SphereGeometry(front ? 0.042 : 0.026, 24, 16), gemMat);
    g.scale.set(1, front ? 1.25 : 1.1, 0.55);
    g.position.set(0, 0.066, R + 0.024);
    holder.add(g);
    crown.add(holder);
  }
  // Orb and cross on top of the cap.
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 16), m.gold);
  orb.position.y = 0.06 + (R - 0.01) * 0.62 + 0.03;
  crown.add(orb);
  const cross = new THREE.Group();
  const bar = new THREE.BoxGeometry(0.018, 0.09, 0.018);
  cross.add(new THREE.Mesh(bar, m.gold));
  const arm = new THREE.Mesh(bar, m.gold);
  arm.rotation.z = Math.PI / 2;
  arm.scale.y = 0.65;
  arm.position.y = 0.012;
  cross.add(arm);
  cross.position.y = orb.position.y + 0.085;
  crown.add(cross);
  return crown;
}

/** Origin: center of the hat's base, cone pointing up +y. */
function buildPartyHat(m: Materials) {
  const hat = new THREE.Group();
  const coneMat = new THREE.MeshPhysicalMaterial({
    map: stripeTexture(),
    roughness: 0.45,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.72, 64, 1, true), coneMat);
  cone.position.y = 0.36;
  hat.add(cone);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 16, 64), m.furWhite);
  rim.rotation.x = Math.PI / 2;
  hat.add(rim);
  const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 3), m.furWhite);
  pom.position.y = 0.74;
  hat.add(pom);
  return hat;
}

/** Origin: midpoint between the eyes, lenses facing +z. `eyeHalf` sets the lens spacing. */
function buildSunglasses(m: Materials) {
  const glasses = new THREE.Group();
  const lensShape = (w: number, h: number) => {
    // Soft wayfarer: flat-ish top, fuller rounded bottom.
    const s = new THREE.Shape();
    s.moveTo(-w / 2, h * 0.38);
    s.bezierCurveTo(-w * 0.2, h * 0.52, w * 0.2, h * 0.52, w / 2, h * 0.4);
    s.bezierCurveTo(w * 0.56, h * 0.05, w * 0.42, -h * 0.5, w * 0.08, -h * 0.5);
    s.bezierCurveTo(-w * 0.3, -h * 0.52, -w * 0.56, -h * 0.25, -w / 2, h * 0.38);
    return s;
  };
  const LW = 0.36;
  const LH = 0.27;
  for (const side of [-1, 1]) {
    const holder = new THREE.Group();
    holder.name = side < 0 ? "lensR" : "lensL";
    const frameShape = lensShape(LW + 0.06, LH + 0.06);
    frameShape.holes.push(lensShape(LW, LH));
    const frame = new THREE.Mesh(bend(extrude(frameShape, 0.024, 0.008), 0.25), m.acetate);
    holder.add(frame);
    const lens = new THREE.Mesh(bend(new THREE.ShapeGeometry(lensShape(LW, LH), 32), 0.25), m.lens);
    holder.add(lens);
    if (side > 0) holder.scale.x = -1; // mirror the shape for the other eye
    glasses.add(holder);
  }
  // Bridge and arms are positioned per frame in poseSunglasses (they depend on lens spacing).
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 12, 24, Math.PI), m.acetate);
  bridge.name = "bridge";
  glasses.add(bridge);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.045, 0.95), m.acetate);
    arm.geometry.translate(0, 0, -0.475);
    arm.name = side < 0 ? "armR" : "armL";
    glasses.add(arm);
  }
  return glasses;
}

/** Origin: the bridge of the nose between the eye holes, mask facing +z. */
function buildMask(m: Materials) {
  const mask = new THREE.Group();
  const outline = (s: number) => {
    const p = new THREE.Shape();
    p.moveTo(0, 0.07 * s);
    p.bezierCurveTo(0.12 * s, 0.13 * s, 0.32 * s, 0.2 * s, 0.56 * s, 0.24 * s);
    p.bezierCurveTo(0.53 * s, 0.1 * s, 0.52 * s, -0.04 * s, 0.44 * s, -0.12 * s);
    p.bezierCurveTo(0.33 * s, -0.2 * s, 0.17 * s, -0.17 * s, 0.07 * s, -0.08 * s);
    p.quadraticCurveTo(0, -0.04 * s, -0.07 * s, -0.08 * s);
    p.bezierCurveTo(-0.17 * s, -0.17 * s, -0.33 * s, -0.2 * s, -0.44 * s, -0.12 * s);
    p.bezierCurveTo(-0.52 * s, -0.04 * s, -0.53 * s, 0.1 * s, -0.56 * s, 0.24 * s);
    p.bezierCurveTo(-0.32 * s, 0.2 * s, -0.12 * s, 0.13 * s, 0, 0.07 * s);
    return p;
  };
  const eyeHole = (cx: number) => {
    const h = new THREE.Path();
    h.moveTo(cx - 0.13, 0.0);
    h.bezierCurveTo(cx - 0.07, 0.085, cx + 0.07, 0.085, cx + 0.13, 0.015);
    h.bezierCurveTo(cx + 0.07, -0.07, cx - 0.07, -0.075, cx - 0.13, 0.0);
    return h;
  };
  const body = outline(1);
  body.holes.push(eyeHole(-0.22), eyeHole(0.22));
  mask.add(new THREE.Mesh(bend(extrude(body, 0.02, 0.009), 0.55), m.lacquer));
  // Gold trim: the same outline a size up, set just behind the lacquer.
  const trimShape = outline(1.05);
  trimShape.holes.push(eyeHole(-0.22), eyeHole(0.22));
  const trim = new THREE.Mesh(bend(extrude(trimShape, 0.012, 0.006), 0.55), m.gold);
  trim.position.set(0, -0.004, -0.012);
  mask.add(trim);
  // A jewel over the nose and two at the wing tips.
  const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.032, 24, 16), m.ruby);
  jewel.scale.set(1, 1.3, 0.55);
  jewel.position.set(0, 0.07, 0.02);
  mask.add(jewel);
  for (const sx of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 12), m.pearl);
    tip.position.set(sx * 0.52, 0.2, 0.02 - 0.55 * 0.52 * 0.52);
    mask.add(tip);
  }
  return mask;
}

/** Origin: top of the head where a headband crosses it; ears point up +y. */
function buildEars(m: Materials, kind: "cat" | "bunny") {
  const group = new THREE.Group();
  const earShape = (w: number, h: number, pointy: boolean) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    if (pointy) {
      s.quadraticCurveTo(-w * 0.42, h * 0.6, -w * 0.04, h);
      s.quadraticCurveTo(w * 0.05, h * 1.02, w * 0.12, h * 0.94);
      s.quadraticCurveTo(w * 0.46, h * 0.5, w / 2, 0);
    } else {
      s.bezierCurveTo(-w * 0.62, h * 0.45, -w * 0.32, h, 0, h);
      s.bezierCurveTo(w * 0.32, h, w * 0.62, h * 0.45, w / 2, 0);
    }
    s.lineTo(-w / 2, 0);
    return s;
  };
  const cat = kind === "cat";
  const W = cat ? 0.26 : 0.16;
  const H = cat ? 0.27 : 0.55;
  const outerMat = cat ? m.furDark : m.furWhite;
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    const outer = new THREE.Mesh(extrude(earShape(W, H, cat), 0.04, 0.03, 32), outerMat);
    ear.add(outer);
    const inner = new THREE.Mesh(
      extrude(earShape(W * 0.6, H * 0.72, cat), 0.01, 0.012, 32),
      m.furPink,
    );
    inner.position.set(0, H * 0.06, 0.045);
    ear.add(inner);
    ear.position.set(side * (cat ? 0.27 : 0.15), 0, 0.02);
    ear.rotation.z = -side * (cat ? 0.32 : 0.16);
    ear.rotation.x = -0.12;
    if (!cat) ear.rotation.y = side * 0.25;
    group.add(ear);
  }
  // Headband over the top of the head, front edge at the ears' base.
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.018, 12, 64, Math.PI),
    cat ? m.acetate : m.furPink,
  );
  band.scale.set(1, 0.42, 1);
  band.position.y = -0.21;
  group.add(band);
  return group;
}

/** Origin: center of the grille ball; the handle runs down −y. */
function buildMic(m: Materials) {
  const mic = new THREE.Group();
  const grilleMat = new THREE.MeshPhysicalMaterial({
    color: 0xc9ced6,
    metalness: 1,
    roughness: 0.42,
    bumpMap: grilleTexture(),
    bumpScale: 2.5,
  });
  const grille = new THREE.Mesh(new THREE.SphereGeometry(0.105, 48, 32), grilleMat);
  grille.scale.y = 1.08;
  mic.add(grille);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.083, 0.08, 0.04, 48), m.silver);
  ring.position.y = -0.1;
  mic.add(ring);
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.078, 0),
        new THREE.Vector2(0.07, -0.08),
        new THREE.Vector2(0.052, -0.3),
        new THREE.Vector2(0.044, -0.5),
        new THREE.Vector2(0.046, -0.53),
        new THREE.Vector2(0.0, -0.535),
      ],
      48,
    ),
    m.rubber,
  );
  body.position.y = -0.12;
  mic.add(body);
  const logo = new THREE.Mesh(new THREE.CylinderGeometry(0.073, 0.073, 0.012, 48), m.gold);
  logo.position.y = -0.2;
  mic.add(logo);
  return mic;
}

// ---------------------------------------------------------------------------------------------
// Pose

type Frame = {
  origin: THREE.Vector3;
  x: THREE.Vector3;
  y: THREE.Vector3;
  z: THREE.Vector3;
  unit: number; // pixels per face unit
};

/** Recovers the head frame (see the file comment) from one frame's landmarks. */
function headFrame(face: NormalizedLandmark[], w: number, h: number): Frame | null {
  const P = (i: number) => new THREE.Vector3(face[i].x * w, -face[i].y * h, -face[i].z * w);
  const cr = P(CHEEK_R);
  const cl = P(CHEEK_L);
  const unit = cr.distanceTo(cl);
  if (!(unit > 4)) return null;
  const origin = cr.clone().add(cl).multiplyScalar(0.5);
  let x = cl.clone().sub(cr).normalize();
  const up = P(FOREHEAD).sub(P(CHIN)).normalize();
  let z = new THREE.Vector3().crossVectors(x, up);
  // A mirrored feed flips handedness; keep +z pointing out of the face, toward the camera.
  if (z.z < 0) {
    x = x.negate();
    z = new THREE.Vector3().crossVectors(x, up);
  }
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return { origin, x, y, z, unit };
}

/** A landmark in head-frame face units. */
function local(f: Frame, face: NormalizedLandmark[], i: number, w: number, h: number) {
  const v = new THREE.Vector3(face[i].x * w, -face[i].y * h, -face[i].z * w).sub(f.origin);
  return new THREE.Vector3(v.dot(f.x), v.dot(f.y), v.dot(f.z)).divideScalar(f.unit);
}

// ---------------------------------------------------------------------------------------------

function createRenderer(): Props3DRenderer {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  let lost = false;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
  });

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  // A soft key light from above-front for the shading direction a ceiling light would give.
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(0.3, 1, 0.8);
  scene.add(key);
  scene.add(key.target);

  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 20000);
  camera.position.set(0, 0, 10000);

  // Everything posed with the head lives under `head`; its transform is the head frame.
  const head = new THREE.Group();
  head.matrixAutoUpdate = false;
  scene.add(head);

  const mats = makeMaterials();
  const occluder = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mats.occluder);
  occluder.renderOrder = -1;
  head.add(occluder);

  const builders: Record<FilterKind, () => THREE.Object3D> = {
    crown: () => buildCrown(mats),
    partyhat: () => buildPartyHat(mats),
    sunglasses: () => buildSunglasses(mats),
    mask: () => buildMask(mats),
    catears: () => buildEars(mats, "cat"),
    bunnyears: () => buildEars(mats, "bunny"),
    mic: () => buildMic(mats),
  };
  const built = new Map<FilterKind, THREE.Object3D>();
  const propFor = (kind: FilterKind) => {
    let obj = built.get(kind);
    if (!obj) {
      obj = builders[kind]();
      built.set(kind, obj);
      head.add(obj);
    }
    return obj;
  };

  let size = { w: 0, h: 0 };
  const basis = new THREE.Matrix4();

  return {
    render(face, kind, w, h, scale = 1) {
      if (lost) return null;
      const f = headFrame(face, w, h);
      if (!f) return null;
      if (size.w !== w || size.h !== h) {
        renderer.setSize(w, h, false);
        camera.left = 0;
        camera.right = w;
        camera.top = 0;
        camera.bottom = -h;
        camera.updateProjectionMatrix();
        size = { w, h };
      }

      basis.makeBasis(f.x, f.y, f.z).scale(new THREE.Vector3(f.unit, f.unit, f.unit));
      basis.setPosition(f.origin);
      head.matrix.copy(basis);
      head.matrixWorldNeedsUpdate = true;

      // Feature positions in face units.
      const L = (i: number) => local(f, face, i, w, h);
      const forehead = L(FOREHEAD);
      const eyeR = L(EYE_R_OUT).add(L(EYE_R_IN)).multiplyScalar(0.5);
      const eyeL = L(EYE_L_OUT).add(L(EYE_L_IN)).multiplyScalar(0.5);
      const eyes = eyeR.clone().add(eyeL).multiplyScalar(0.5);
      const bridge = L(NOSE_BRIDGE);
      const mouth = L(LIP_TOP).add(L(LIP_BOTTOM)).multiplyScalar(0.5);
      const chin = L(CHIN);
      // Head volume: front just behind the eyes, reaching up past the hairline and back past the
      // ears — sized off this face so it never cuts into props worn on the face itself.
      const headR = { x: 0.53, y: 0.78, z: 0.62 };
      const headC = new THREE.Vector3(0, eyes.y + 0.12, Math.min(eyeR.z, eyeL.z) - 0.06 - headR.z);
      occluder.position.copy(headC);
      occluder.scale.set(headR.x, headR.y, headR.z);

      for (const [k, obj] of built) obj.visible = k === kind;
      const prop = propFor(kind);
      prop.visible = true;
      prop.scale.setScalar(scale);
      prop.rotation.set(0, 0, 0);

      // Height of the head's surface at a point (x, z) of the head frame — where things that sit
      // ON the head (crown, hat, headband) rest, instead of floating above it or sinking inside the
      // occluder.
      const headTop = (x: number, z: number) => {
        const k = 1 - ((x - headC.x) / headR.x) ** 2 - ((z - headC.z) / headR.z) ** 2;
        return headC.y + headR.y * Math.sqrt(Math.max(0, k));
      };
      const midX = bridge.x;

      switch (kind) {
        case "crown": {
          // Worn on top of the head, tipped back a little like a real crown sits.
          const z = headC.z + 0.08;
          prop.position.set(midX, headTop(midX, z) - 0.3, z);
          prop.rotation.x = -0.22;
          break;
        }
        case "partyhat": {
          const z = headC.z + 0.18;
          prop.position.set(midX + 0.08, headTop(midX + 0.08, z) - 0.07, z);
          prop.rotation.set(-0.3, 0, -0.24);
          break;
        }
        case "catears":
        case "bunnyears": {
          const z = headC.z + 0.24;
          prop.position.set(midX, headTop(midX, z) - 0.04, z);
          prop.rotation.x = -0.28;
          break;
        }
        case "sunglasses": {
          const half = Math.max(0.15, eyeR.distanceTo(eyeL) / 2);
          const gz = Math.max(eyeR.z, eyeL.z, bridge.z - 0.05) + 0.1;
          prop.position.set(eyes.x, eyes.y + 0.005, gz);
          // Roll from the eye line is already in the head frame; spread the lenses to these eyes.
          const lr = prop.getObjectByName("lensR")!;
          const ll = prop.getObjectByName("lensL")!;
          lr.position.set(-half - 0.005, 0, 0);
          ll.position.set(half + 0.005, 0, 0);
          const br = prop.getObjectByName("bridge")!;
          br.position.set(0, 0.07, 0.005);
          br.scale.set((half - 0.17) / 0.05 + 0.1, 0.8, 1);
          const outer = half + 0.2;
          for (const [name, sx] of [
            ["armR", -1],
            ["armL", 1],
          ] as const) {
            const arm = prop.getObjectByName(name)!;
            arm.position.set(sx * outer, 0.06, -0.02);
            arm.rotation.set(-0.05, sx * 0.1, 0);
          }
          break;
        }
        case "mask": {
          // Eye holes are modeled 0.22 apart from center; stretch to this face's eye spacing.
          const half = Math.max(0.15, eyeR.distanceTo(eyeL) / 2);
          prop.scale.set(
            (0.9 * scale * half) / 0.22,
            0.9 * scale * Math.min(1.2, half / 0.22),
            scale,
          );
          prop.position.set(
            eyes.x,
            eyes.y + 0.01,
            Math.max(eyeR.z, eyeL.z, bridge.z - 0.06) + 0.08,
          );
          break;
        }
        case "mic": {
          // A real handheld mic: grille just under the lower lip, held a hand's width out.
          prop.scale.setScalar(scale * 1.6);
          const jaw = Math.max(0.12, mouth.y - chin.y);
          prop.position.set(midX + 0.07, mouth.y - jaw * 0.32, mouth.z + 0.4);
          prop.rotation.set(0.85, 0, -0.35);
          break;
        }
      }

      renderer.render(scene, camera);
      return canvas;
    },
  };
}
