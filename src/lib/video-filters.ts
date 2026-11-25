/**
 * Whole-frame "look" filters for the selfie camera — the Instagram/Photoshop-style counterpart to
 * virtual-background.ts's scene replacement: instead of swapping what's behind you, these grade
 * the entire frame (contrast, saturation, color cast...) via the same canvas `ctx.filter` API
 * already used for the "blur" background (see virtual-background.ts:339). Applied by
 * camera-effects.ts, which draws every frame through whichever CSS filter string is active here —
 * so a look is live in the preview and, since the preview canvas is exactly what gets recorded,
 * baked into the take (and therefore into whatever gets published) with no separate export step.
 *
 * The "beauty" looks (photoshoot, freckles, eye color, blush, lips) add a face-tracked pass on top
 * of their grade — see LOOK_BEAUTY below and beauty-effects.ts.
 */
import type { BeautyRecipe } from "./beauty-effects";

export type LookId =
  | "none"
  | "photoshoot"
  | "glam"
  | "glassSkin"
  | "freckles"
  | "blush"
  | "lips"
  | "eyesBlue"
  | "eyesGreen"
  | "eyesHazel"
  | "hd"
  | "bw"
  | "noir"
  | "vintage"
  | "warm"
  | "cool"
  | "vivid";

export const LOOK_OPTIONS: { id: LookId; labelKey: string }[] = [
  { id: "none", labelKey: "record.look.none" },
  { id: "photoshoot", labelKey: "record.look.photoshoot" },
  { id: "glam", labelKey: "record.look.glam" },
  { id: "glassSkin", labelKey: "record.look.glassSkin" },
  { id: "freckles", labelKey: "record.look.freckles" },
  { id: "blush", labelKey: "record.look.blush" },
  { id: "lips", labelKey: "record.look.lips" },
  { id: "eyesBlue", labelKey: "record.look.eyesBlue" },
  { id: "eyesGreen", labelKey: "record.look.eyesGreen" },
  { id: "eyesHazel", labelKey: "record.look.eyesHazel" },
  { id: "hd", labelKey: "record.look.hd" },
  { id: "vivid", labelKey: "record.look.vivid" },
  { id: "warm", labelKey: "record.look.warm" },
  { id: "cool", labelKey: "record.look.cool" },
  { id: "vintage", labelKey: "record.look.vintage" },
  { id: "bw", labelKey: "record.look.bw" },
  { id: "noir", labelKey: "record.look.noir" },
];

// Standard CSS filter syntax — valid both as a canvas 2D context `filter` string (used per-frame
// by camera-effects.ts) and as a plain CSS `filter` style (used by LookPicker's tile previews), so
// a tile always shows exactly the grade it'll actually apply.
export const LOOK_FILTERS: Record<LookId, string> = {
  none: "none",
  // A clean, bright editorial grade under the retouch: lifted exposure, gentle contrast, a hint
  // of warmth in the skin.
  photoshoot: "brightness(1.05) contrast(1.07) saturate(1.08) sepia(0.06)",
  // Evening glam: a touch richer and warmer, a little more contrast for the makeup to sit in.
  glam: "contrast(1.08) saturate(1.1) sepia(0.05) brightness(1.02)",
  // Glass skin: luminous and clean — brighter, slightly softer contrast, fresh not warm.
  glassSkin: "brightness(1.07) contrast(0.97) saturate(1.06)",
  // Sun-kissed: a little warmer and richer, the way freckle filters are usually shot.
  freckles: "sepia(0.1) saturate(1.12) brightness(1.03)",
  blush: "brightness(1.03) saturate(1.06)",
  lips: "contrast(1.04) saturate(1.05)",
  eyesBlue: "contrast(1.04)",
  eyesGreen: "contrast(1.04)",
  eyesHazel: "contrast(1.04)",
  // "4K" as a look, not an upscale: a crisper, punchier grade (more contrast/saturation, a touch
  // of brightness) that reads as "higher quality" the way a phone's default HDR-ish camera mode
  // does — see the product decision in the PR this shipped with. No pixel count changes.
  hd: "contrast(1.12) saturate(1.18) brightness(1.02)",
  vivid: "saturate(1.55) contrast(1.15)",
  warm: "sepia(0.18) saturate(1.25) hue-rotate(-8deg) brightness(1.03)",
  cool: "saturate(1.1) hue-rotate(15deg) contrast(1.05) brightness(1.02)",
  vintage: "sepia(0.35) saturate(1.05) contrast(0.95) brightness(1.03)",
  bw: "grayscale(1) contrast(1.08)",
  noir: "grayscale(1) contrast(1.35) brightness(0.88)",
};

// The face-tracked part of each beauty look (beauty-effects.ts). Looks not listed are grade-only.
export const LOOK_BEAUTY: Partial<Record<LookId, BeautyRecipe>> = {
  // A retoucher's pass: evened skin with its real texture kept, dodge & burn, a brighter
  // under-eye, whiter teeth and eyes, a soft studio glow and a light vignette.
  photoshoot: {
    smooth: 0.6,
    sculpt: 0.7,
    underEye: 0.6,
    teeth: 0.7,
    eyePop: 0.22,
    glow: 0.12,
    vignette: 0.24,
  },
  // Evening makeup: winged liner, a bronze smoky lid, rosy-nude lips and sculpted cheeks.
  glam: {
    smooth: 0.45,
    sculpt: 0.8,
    liner: 1,
    shadow: "122,72,58",
    lips: "170,58,72",
    blush: 0.45,
    teeth: 0.5,
    eyePop: 0.18,
  },
  // K-beauty glass skin: smooth, even and dewy with light catching the high points.
  glassSkin: { smooth: 0.55, dewy: 1, underEye: 0.5, glow: 0.1, blush: 0.25 },
  freckles: { smooth: 0.25, freckles: true, blush: 0.4 },
  blush: { smooth: 0.3, blush: 1 },
  lips: { smooth: 0.25, lips: "190,36,70", teeth: 0.4 },
  eyesBlue: { eyes: "blue", eyePop: 0.12 },
  eyesGreen: { eyes: "green", eyePop: 0.12 },
  eyesHazel: { eyes: "hazel", eyePop: 0.12 },
};
