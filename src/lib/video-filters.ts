/**
 * Whole-frame "look" filters for the selfie camera — the Instagram/Photoshop-style counterpart to
 * virtual-background.ts's scene replacement: instead of swapping what's behind you, these grade
 * the entire frame (contrast, saturation, color cast...) via the same canvas `ctx.filter` API
 * already used for the "blur" background (see virtual-background.ts:339). Applied by
 * camera-effects.ts, which draws every frame through whichever CSS filter string is active here —
 * so a look is live in the preview and, since the preview canvas is exactly what gets recorded,
 * baked into the take (and therefore into whatever gets published) with no separate export step.
 */
export type LookId = "none" | "hd" | "bw" | "noir" | "vintage" | "warm" | "cool" | "vivid";

export const LOOK_OPTIONS: { id: LookId; labelKey: string }[] = [
  { id: "none", labelKey: "record.look.none" },
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
