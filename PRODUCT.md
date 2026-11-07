# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Mobile-first responsive web app (content column capped around 520px with a bottom nav on phones; a side nav from `lg` up). It is not a native app.

## Users

Singers of every level, worldwide: casual karaoke fans singing for fun, hobbyists, and aspiring or working singers trying to build a career. They sing covers over karaoke backing tracks, original songs, and anything in between. The usual setting is a phone, often a phone mic in a normal room, sometimes with headphones. Their job is to get a take that sounds good, share it, compete, and be heard by fans and by the industry.

Secondary audience: labels and talent scouts who use the Label Hub to search for talent and run auditions. The tool exists, but no real labels are on board yet.

## Product Purpose

Studio26 is a music social network built around singing. A user records a vocal on their phone, with or without a karaoke track, and the recording goes straight into the studio. There they mix and process it: real-time DSP on the vocal stem, a vocal/backing balance, and AI vocal cleanup. They then publish to the feed, enter competitions, and cross-post to other platforms. Fans follow, like, comment, message, and send virtual gifts. Tagline: "Sing. Compete. Get discovered."

Success means a phone take sounds like a real recording, and singing in the app can turn into exposure and opportunity.

## Positioning

Two claims carry equal weight, and the product exists to deliver both together:

1. **Studio sound from a phone.** Processing works on the actual waveform, not on presets laid over a mixed file. The vocal and backing are separate stems, DSP runs on the vocal only, and the backing is aligned for bleed using GCC-PHAT. The offline mix adds a noise gate, de-esser, and adaptive EQ. ML cleanup can remove the room, reverb, and backing bleed.
2. **Getting discovered.** Competitions with voting, the Label Hub, auditions, and live Duet Battles turn performances into a path toward a career.

## Operating Context

- Core flow: Record (mic, optional karaoke video in sync, pause/resume), then the Studio (the only place for editing: live DSP, mix balance, AI cleanup, fix-a-section), then publish, export, or send to a competition. Recording has no separate "save" step.
- Feed: vertical, TikTok-style scrolling. The visible post plays audio automatically (starts muted, and one tap unmutes everything after it).
- Other surfaces: Explore/search, Competitions, Live (LiveKit; Go Live, Duet Battle), Wallet, DMs, Notifications, Profile, Label Hub, Upload, Admin.
- Create menu (center nav button): Record, Go Live, Upload.
- Headphones are recommended while recording, since bleed from the phone speaker is a real quality problem.

## Capabilities and Constraints

- Stack (existing): React 19, TanStack Start (Router/Query, server functions), Vite, Tailwind v4, Radix/shadcn-style UI, framer-motion, Tone.js/Web Audio, Drizzle with Postgres (Neon in prod), Vercel Blob, and LiveKit. Deployed on Vercel.
- Languages: English, Hebrew, and Arabic are complete, including RTL and server-side language detection. More languages will be added for a truly global audience, so layouts and copy must not assume one language or one direction.
- Economy: virtual coins only (buy, gift, withdraw inside a closed economy). There is no real money. Pro is bought with coins and gives free exports and a Pro badge.
- Roles: `user` and `admin`. Admins manage competitions in /admin. Entering and voting are allowed only for `active` competitions, and the server enforces this.
- Karaoke catalog: songs are supplied by the operator (MP4 files with the lyrics burned in). There is intentionally no commercial music catalog, because of copyright.
- Built but not configured: Publish Everywhere (YouTube Shorts, TikTok, and Instagram Reels need OAuth credentials; Spotify, Apple Music, and SoundCloud are share-only handoffs), and Live in production (LiveKit keys are set locally only). AI vocal cleanup needs a Replicate deployment.
- Instagram cross-posting needs MP4 output, which only Chrome can record.
- Undecided: which languages come next, and the launch market order.

## Brand Commitments

- Name: **Studio26**. It was earlier called SONA, and some docs still use that name.
- Logo assets: `public/brand/logo-wordmark.png`, `public/brand/logo-wordmark-alpha.png` (transparent, used in the UI), and `public/brand/logo-mark.png`. The logo is black/chrome/neon.
- Tagline: "Sing. Compete. Get discovered." / "שירה. תחרות. חשיפה." / "غنِّ. تنافس. اكتشف."
- Dark-first UI with no light mode, by the owner's decision on 2026-10-16, so the UI matches the logo.

## Evidence on Hand

- Pre-launch. Production has only the owner's account and no competitions. Demo data was removed on 2026-10-16.
- There are no real users, testimonials, label partners, play counts, or statistics. Future work must not invent any of these, including sample "trusted by" lists, fake counts, or quotes.
- The karaoke library currently has two songs.
- One real artifact exists: a 76-second, 7.3 MB recording saved and published end-to-end in production.

## Product Principles

1. **The take is sacred.** Every surface that touches a recording must protect its quality and timing. No processing should quietly degrade the sound, and what the user hears in the studio is what gets published.
2. **Real, not demo.** Every button does something, and every number is real. If a feature isn't configured, say so honestly instead of faking it.
3. **Sound and stage together.** Studio quality and discovery are equal halves. Neither should be framed as an add-on to the other.
4. **Every singer, every language.** Serve beginners and professionals, covers and originals, LTR and RTL, without making any one of them the default "real" user.
5. **One clear path from voice to audience.** Record → Studio → Publish/Compete should feel like one continuous flow, not separate tools.

## Accessibility & Inclusion

- Every text/background pair must meet WCAG AA 4.5:1 contrast on the dark UI.
- Full RTL support for Hebrew and Arabic, now and for future RTL languages. User-written text uses automatic bidi detection.
- Built for phones: the main controls must be reachable in a recording context with one hand, and autoplay respects browser rules (muted until tapped).
