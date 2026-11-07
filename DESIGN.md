---
name: Studio26
description: Sing. Compete. Get discovered. A dark-first music social network.
colors:
  night-ink: "oklch(0.155 0.014 280)"
  stage-panel: "oklch(0.205 0.016 280)"
  raised-panel: "oklch(0.225 0.016 280)"
  quiet-panel: "oklch(0.25 0.016 280)"
  paper-white: "oklch(0.965 0.006 85)"
  haze-text: "oklch(0.74 0.016 275)"
  hairline: "oklch(1 0 0 / 0.09)"
  coral-fill: "oklch(0.57 0.2 25)"
  coral-text: "oklch(0.7 0.17 27)"
  marigold: "oklch(0.82 0.15 88)"
  marigold-ink: "oklch(0.22 0.04 90)"
  indigo-fill: "oklch(0.38 0.13 275)"
  indigo-text: "oklch(0.74 0.11 275)"
  teal-fill: "oklch(0.52 0.1 195)"
  teal-text: "oklch(0.74 0.11 195)"
  danger-fill: "oklch(0.55 0.21 25)"
  danger-text: "oklch(0.7 0.18 22)"
typography:
  display:
    fontFamily: "Rubik, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  readout:
    fontFamily: "Unbounded, Rubik, ui-sans-serif, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Rubik, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Rubik, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Rubik, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
  caption:
    fontFamily: "Rubik, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.3
  micro:
    fontFamily: "Rubik, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1.2
rounded:
  sm: "10px"
  md: "12px"
  lg: "14px"
  xl: "18px"
  2xl: "22px"
  3xl: "26px"
  full: "9999px"
spacing:
  gutter: "16px"
  card: "16px"
  card-tight: "12px"
  stack: "12px"
components:
  button-primary:
    backgroundColor: "{colors.coral-fill}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: "14px 20px"
    typography: "{typography.label}"
  button-quiet:
    backgroundColor: "{colors.quiet-panel}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.full}"
    padding: "10px 16px"
  button-gold:
    backgroundColor: "{colors.marigold}"
    textColor: "{colors.marigold-ink}"
    rounded: "{rounded.full}"
    padding: "10px 20px"
  card:
    backgroundColor: "{colors.stage-panel}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.2xl}"
    padding: "{spacing.card}"
  chip:
    backgroundColor: "{colors.quiet-panel}"
    textColor: "{colors.haze-text}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
  chip-selected:
    backgroundColor: "{colors.coral-fill}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.quiet-panel}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    height: "48px"
    padding: "12px 16px"
  nav-create:
    backgroundColor: "{colors.coral-fill}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.2xl}"
    size: "56px"
---

# Design System: Studio26

## Overview

**Creative North Star: "Night Studio"**

Studio26 feels like a recording room after dark. The surfaces are near-black with a faint violet cast, the panels look like gear racks lit from inside, and the color sits where the signal is: a coral record light, a marigold meter needle, and an indigo or teal cue light. It matches the logo, which is black, chrome, and neon. The UI is dark-only, by the owner's decision on 2026-10-16. There is no light mode, and none should be added.

This is a phone app first that scales to a real desktop layout. The feed goes full-bleed; working screens are built from a few strong panels and grouped lists, never a stack of look-alike cards. Interactions are quick and physical: firm presses, fader-like settles, and fast staggered reveals. Motion confirms touch. It never performs for its own sake.

The work is in sound, so the screens that touch a recording (Record, Studio, Fix Section) are where precision matters most. A control that changes a take must never change by accident.

**Key Characteristics:**
- Dark-only ground with violet-tinted neutrals (hue 275–280), never pure black or grey.
- Coral is the action and "on air" color, and marigold is the active, selected, or value color.
- Firm corners: 12px buttons, 22px panels, pills only for chips and tags; a hairline white border at 9% opacity.
- Rubik for every word in every script; Unbounded only for numeric readouts (prizes, coins, counts).
- The level meter (gold body, coral peak) is the signature motif.
- Exponential settle on touch (`--ease-snappy`), no bounce.

## Colors

The palette is near-black stage panels plus four signal hues. Each signal hue comes in two shades: a deep **fill** that carries a white label, and a light **text** shade that reads on the dark ground.

### Primary
- **Record-Light Coral** (fill `coral-fill`, text `coral-text`): Primary actions (Publish, Record, the create button), the "live" state, and links. Fill buttons always pair with white labels (4.8:1). Coral text on the dark ground uses the light shade (6.8:1).

### Secondary
- **Meter Marigold** (`marigold`): Active navigation, selected values, slider readouts, section icons, and Pro/gold rewards. As a fill it takes the dark `marigold-ink` label, never white.

### Tertiary
- **Cue Indigo** (`indigo-fill` / `indigo-text`) and **Monitor Teal** (`teal-fill` / `teal-text`): Secondary categories, badges, and informational states. Use them sparingly.

### Neutral
- **Night Ink** (`night-ink`): The page ground.
- **Stage Panel** (`stage-panel`): Cards and sections.
- **Raised Panel** (`raised-panel`): Popovers, sheets, and dialogs.
- **Quiet Panel** (`quiet-panel`): Input wells, quiet buttons, unselected chips, and slider tracks.
- **Paper White** (`paper-white`): Primary text. It is warm, not blue-white.
- **Haze** (`haze-text`): Secondary text and hints.
- **Hairline** (`hairline`): Every border and divider.
- **Danger** (`danger-fill` / `danger-text`): Destructive actions and errors.

### Named Rules
**The Two-Shade Rule.** Colored text uses the text shades (`text-brand-coral`, `text-brand-indigo`, `text-brand-teal`, `text-danger`). Never use core `text-primary` or `text-destructive`, because those are the fill shades and fail contrast on the dark ground. Every text/fill pair must reach WCAG AA 4.5:1.

**The Gold Label Rule.** Anything filled with marigold takes the dark marigold-ink label. White on gold is never allowed.

## Typography

**Text Font:** Rubik (400–800), for headings and body alike
**Readout Font:** Unbounded (500–800), digits only

**Character:** Rubik covers Latin, Cyrillic, Hebrew and Arabic in one family, so a Hebrew heading and its English neighbour share metrics and voice in every language the app ships. Unbounded is wide and confident; it is reserved for numbers people read like a meter (prize, coins, likes), set with tabular figures.

### Hierarchy
- **Page title** (700, 1.875rem, -0.02em, `page-title` utility): Every screen title, identical everywhere.
- **Title** (700, 1.125rem): Section and card titles.
- **Body** (400–500, 0.875rem): Descriptions, list rows, and messages.
- **Label** (600–700, 0.75rem): Buttons, chips, slider labels, and nav labels (nav labels are 10px).
- **Readout** (Unbounded 700, `font-numeric`): Prizes, balances, big counts. Small values (slider, timer) use Rubik tabular figures (`font-mono`).

### Named Rules
**The Arabic Joining Rule.** Arabic text gets no letter-spacing, ever. `:lang(ar)` resets it globally, so don't fight that reset.

**The Bidi Rule.** User-written text (titles, bios, comments, handles, messages) gets `bidi-auto`, so its own direction wins inside an RTL or LTR page.

## Layout

- Phones: one 520px column with 16px side gutters and a fixed bottom nav.
- Tablet (`md`): the per-screen column widths already apply (`default` 672px, `wide` 1024px); the feed is full-bleed; the top bar and bottom nav surfaces reach the screen edges while their contents stay in the column. A tablet never reads as a phone in a letterbox.
- Desktop (`lg`): a side nav replaces the bottom nav. Messaging is two-pane (inbox beside the open thread; /messages opens the latest conversation). Admin tables appear only from `lg`; below it the same data is list rows.
- Page rhythm: title at `pt-6`, the first block `mt-5`/`mt-6` below it, `pb-8` at the end.
- The bottom nav respects `env(safe-area-inset-bottom)`. Content leaves room for it.
- The feed is full-bleed and vertical, one post per screen, with an overlay nav that fades from black.
- Other screens stack sections: `mt-4` between panels, and 16px padding inside them (12px for tight cards).
- Layouts use logical properties (`text-start`, `ms-`, `me-`) so RTL mirrors automatically.

## Elevation & Depth

Depth here is mostly tonal. Each panel step is a few points lighter than the one below it, and every panel has the hairline border. Shadows are soft and dark, and they set things apart rather than float them.

### Shadow Vocabulary
- **Pop** (`--shadow-pop`): The default for cards and sections.
- **Pop Large** (`--shadow-pop-lg`): Hover lifts and dialogs.
- **Coral Glow** (`--shadow-pop-coral`): Only under coral primary actions, as the "record light" glow.
- **Nav surface** (`nav-surface` utility: solid card): the fixed top bar and bottom nav are fully opaque. Content scrolling underneath never reads through.
- **Glass** (`glass` utility: card at 82% with an 18px blur): small floating controls over imagery (feed actions) only, never a bar over text.

### Named Rules
**The One Glow Rule.** Only the primary action on a screen gets the coral glow.

## Shapes

- The base radius is 14px (`--radius`). Panels and sections use 22px, rows and inner tiles 14–18px, buttons 12px (`rounded-xl`).
- Pills are for chips, tags and status only; avatars and the transport (play) button are circles.
- The create button is the one exception: a 56px rounded square (26px radius) that rises above the nav.

## Components

### Buttons
- **Shape:** 12px corners, 48–56px tall in action rows.
- **Primary:** coral fill, white bold label, coral glow, `press-scale`. One per screen.
- **Secondary:** transparent with a strong hairline (`--hairline-strong`), white label, an icon in its meaning colour.
- **Transport:** the play/pause button is a white circle with a dark glyph, so it never competes with the coral action.
- **AI / tool action:** tonal marigold (tint fill, marigold border and label). Strong, but never a second solid primary next to the coral action.
- **Disabled:** 50% opacity. Actions that can't run yet still respond to taps with a toast that explains why. They are never dead.
- **Touch target:** at least 44px of tappable height, even when the visible pill is smaller.

### Chips
- **Style:** pill, 12px semibold label, quiet-panel fill.
- **Selected:** coral fill with a white label, or marigold text for value toggles.

### Panels and grouped lists
- **Panel:** 22px corners, Stage Panel, hairline, the Pop shadow (an inner top highlight, almost no lift), 16px padding.
- **Grouped list (`list-group`):** related rows live in one panel divided by hairlines; rows highlight on hover (`bg-muted/50`) and never lift. A stack of separate cards for list items is not allowed.
- **Poster:** a featured item (competition) is a full-bleed image panel with the key number as a readout.

### Segmented control
- A sunken track with the selected option lifted onto a muted panel that slides between positions (`Segmented` component). Used for tabs over a list and either/or choices.

### Toasts
- Raised panel, strong hairline, 16px corners; meaning lives in the icon colour (teal success, coral error, marigold info).

### Empty states
- The subject icon in a muted tile over a resting level meter (`LevelMeter resting`), one line of copy, one action. No glowing rings or orbs.

### Placeholder art
- A post or competition without a cover gets `PostCoverBg`: the hue field with two soft glows and a seed-shaped level-meter silhouette. No orbs or concentric rings.

### Gifts
- Drawn glyphs from the icon set in palette tones (`GiftGlyph`), never OS emoji (they render differently on every phone).

### Level meter (signature)
- `LevelMeter`: bars coloured by absolute level, marigold body turning coral at the peak. Used on the record stage door; can breathe when live, still under reduced motion.

### Inputs / Fields
- **Style:** the global `.input` class: 48px tall, 12px corners, input fill, hairline border (stronger on hover), 16px text on phones so iOS never zooms. Never redefine it per screen.
- **Focus:** coral ring border plus a soft 3px coral halo.
- **Labels:** every field carries an accessible name (`aria-label` at minimum when the design shows only a placeholder).

### Sliders (studio controls)
- **Style:** a full-width row with the label at the start and a mono marigold value at the end. The track is quiet-panel, the fill is coral, and the thumb is white.
- **Behavior:** see the Scroll-Safe Control Rule. On touch, a slider changes only on a deliberate horizontal drag, measured from the current value. A tap or a vertical swipe scrolls the page and leaves the value alone. With a mouse, clicking the track jumps the value. With a keyboard, the arrow keys step it.

### Navigation
- **Bottom nav:** five slots. Inactive items are haze. The active item is marigold, lifted 2px, with a small marigold dot above it. The center slot is the coral create button, which opens the Record / Go Live / Upload sheet.
- **Overlay variant (feed):** white at 70% over a black gradient.

### Named Rules
**The Scroll-Safe Control Rule.** Any control that sits inside a scrolling list and changes a value (sliders, steppers, toggles in long panels) must not react to a touch that starts a scroll. Value controls on touch begin only after intent is clear: a horizontal drag past a small threshold. Never use a bare `<input type="range">` in a scrolling panel on mobile.

## Do's and Don'ts

### Do:
- **Do** pair every fill with its matching label shade (white on coral, indigo, or teal; marigold-ink on marigold).
- **Do** use the text shades for colored text on the dark ground.
- **Do** give the primary action on a screen the coral fill and glow, and only that one.
- **Do** use logical spacing and `text-start` so layouts mirror in RTL.
- **Do** set prizes, balances and big counts in Unbounded (`font-numeric`) so they scan as instruments.
- **Do** group list rows into one `list-group` panel.

### Don't:
- **Don't** add a light theme or light surfaces.
- **Don't** stack look-alike cards for list items, or decorate with blurred colour blobs and floating icons.
- **Don't** show a fake waveform: draw the take's real envelope or nothing.
- **Don't** use `text-primary` or `text-destructive` for text.
- **Don't** put white text on marigold.
- **Don't** add letter-spacing to Arabic.
- **Don't** let a value control change on a scroll gesture or an accidental tap.
- **Don't** invent social proof (counts, testimonials, label logos). Studio26 is pre-launch.
