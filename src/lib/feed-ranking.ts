// "For You" ranking for the main feed — pure functions only (no DB), so the whole scoring model
// lives in one place and can be reasoned about / tuned without touching the server plumbing in
// functions/recommendations.ts.
//
// The model, in short:
//   1. Every post is described by a handful of weighted *features* (its author, category, tags,
//      song, karaoke artist, type, video-vs-audio).
//   2. Every viewer has an *interest profile*: one decaying score per feature, pushed up by
//      positive signals (watching to the end, replays, likes, comments, shares, gifts, follows)
//      and down by negative ones (swiping straight past, unliking, unfollowing).
//   3. A candidate post's score = how well its features match the profile + how good the post
//      is in general (engagement rate, average completion) + freshness + follow boost − a
//      penalty for having already been seen, with a little noise so the feed never goes stale.
//   4. A greedy re-rank then spreads creators/songs out and reserves every 5th slot for
//      discovery (good posts *outside* the viewer's current interests), so the profile can keep
//      learning instead of collapsing into a single bubble.

// ---------- features ----------

export type FeaturePost = {
  userId: string;
  type: string;
  category: string;
  tags: string[];
  songTitle: string;
  karaokeTrackId: string | null;
  trackArtist: string | null;
  hasVideo: boolean;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 80);
}

// How strongly a signal on a post spills onto each of its features. Author is the strongest
// thing people come back for; the post type (cover/original/...) is a weak, broad preference.
const FEATURE_WEIGHT = {
  author: 1.0,
  track: 0.8,
  artist: 0.7,
  cat: 0.6,
  song: 0.5,
  tag: 0.5,
  type: 0.3,
  media: 0.2,
} as const;

const MAX_TAGS = 6;

/** The weighted features describing a post. Tag weights are split so a post with ten tags
 * doesn't count ten times as much as a post with one. */
export function postFeatures(p: FeaturePost): Array<[feature: string, weight: number]> {
  const out: Array<[string, number]> = [
    [`author:${p.userId}`, FEATURE_WEIGHT.author],
    [`media:${p.hasVideo ? "video" : "audio"}`, FEATURE_WEIGHT.media],
  ];
  if (p.type) out.push([`type:${p.type}`, FEATURE_WEIGHT.type]);
  const cat = norm(p.category);
  if (cat) out.push([`cat:${cat}`, FEATURE_WEIGHT.cat]);
  if (p.karaokeTrackId) out.push([`track:${p.karaokeTrackId}`, FEATURE_WEIGHT.track]);
  const artist = p.trackArtist ? norm(p.trackArtist) : "";
  if (artist) out.push([`artist:${artist}`, FEATURE_WEIGHT.artist]);
  const song = norm(p.songTitle);
  if (song) out.push([`song:${song}`, FEATURE_WEIGHT.song]);
  const tags = [...new Set(p.tags.map(norm).filter(Boolean))].slice(0, MAX_TAGS);
  const tagWeight = tags.length ? FEATURE_WEIGHT.tag / Math.sqrt(tags.length) : 0;
  for (const tag of tags) out.push([`tag:${tag}`, tagWeight]);
  return out;
}

// ---------- signals ----------

/** Profile delta per explicit action, before the per-feature weights are applied. */
export const SIGNAL = {
  like: 2.5,
  unlike: -2.5,
  comment: 3,
  share: 4,
  gift: 5,
  // Follow/unfollow only touch the author feature (a follow says "this person", not "this tag").
  follow: 6,
  unfollow: -6,
} as const;

/** Interest scores halve every 14 days without new signals. */
export const AFFINITY_HALF_LIFE_SECONDS = 14 * 24 * 3600;
export const AFFINITY_MIN = -20;
export const AFFINITY_MAX = 50;

export function decayedScore(score: number, updatedAt: Date, now: Date): number {
  const ageSeconds = Math.max(0, (now.getTime() - updatedAt.getTime()) / 1000);
  return score * Math.pow(0.5, ageSeconds / AFFINITY_HALF_LIFE_SECONDS);
}

export type ViewInput = { watchedMs: number; dwellMs: number; durationMs: number };
export type ViewOutcome = { ratio: number; skipped: boolean; weight: number };

/** Below this the post just flashed by during a fast fling — not a real impression at all. */
const MIN_DWELL_MS = 700;

/** Turns one feed impression into a profile signal. Watch ratio is the core of it (a full watch
 * ≈ +1, replays up to ≈ +3.4); a quick swipe-past is a mild negative. For long tracks, 45 s of
 * actual listening already counts as a full watch, since nobody "completes" a 4-minute song
 * while scrolling a feed. */
export function viewSignal({ watchedMs, dwellMs, durationMs }: ViewInput): ViewOutcome | null {
  if (dwellMs < MIN_DWELL_MS) return null;
  // No playable/loaded media (cover-only post, or it failed to load): fall back to dwell time.
  const ratio =
    durationMs > 1000 && watchedMs > 0
      ? watchedMs / durationMs
      : Math.min(dwellMs, 60_000) / 20_000;
  const effective = Math.min(3, Math.max(ratio, watchedMs / 45_000));
  const skipped = dwellMs < 2500 && effective < 0.25;
  const weight = skipped ? -0.8 : effective * 1.2 - 0.2;
  return { ratio, skipped, weight };
}

// ---------- ranking ----------

export type RankCandidate = FeaturePost & {
  id: string;
  createdAt: Date;
  viewsCount: number;
  watchRatioSum: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  giftsCount: number;
  authorCountry: string;
};

export type SeenInfo = { lastViewedAt: Date; skipped: boolean };

export type RankContext = {
  viewerId: string | null;
  viewerCountry: string;
  /** Decayed profile scores, keyed by feature. */
  affinity: Map<string, number>;
  /** How many distinct posts the viewer has watched — drives how much we trust the profile. */
  watchedCount: number;
  seen: Map<string, SeenInfo>;
  following: Set<string>;
  now: Date;
  random?: () => number;
};

/** Profile scores are unbounded-ish; squash so one obsessive feature can't drown the rest. */
function squash(score: number): number {
  return Math.tanh(score / 6);
}

function affinityOf(features: Array<[string, number]>, affinity: Map<string, number>): number {
  let sum = 0;
  for (const [f, w] of features) {
    const s = affinity.get(f);
    if (s) sum += w * squash(s);
  }
  return sum;
}

/** Engagement rate and average completion, both Bayesian-smoothed toward a neutral prior so a
 * post with 1 view and 1 like doesn't look like the best thing ever posted. */
export function qualityOf(c: RankCandidate): number {
  const interactions = c.likesCount + 2 * c.commentsCount + 3 * c.sharesCount + 3 * c.giftsCount;
  const engagement = (interactions + 1) / (c.viewsCount + 8);
  const engScore = Math.min(1.5, Math.log1p(engagement * 4));
  const completion = (c.watchRatioSum + 0.5 * 4) / (c.viewsCount + 4);
  return engScore + (completion - 0.5) * 1.5;
}

type Scored = {
  c: RankCandidate;
  score: number;
  exploreScore: number;
  artist: string | null;
};

function scoreCandidate(
  c: RankCandidate,
  ctx: RankContext,
  maturity: number,
  rand: () => number,
): Scored {
  const features = postFeatures(c);
  const aff = affinityOf(features, ctx.affinity);
  const quality = qualityOf(c);

  const ageHours = Math.max(0, (ctx.now.getTime() - c.createdAt.getTime()) / 3_600_000);
  // Recency, plus guaranteed early exposure for posts nobody has seen yet — without that a new
  // creator's first post could never collect the views it needs to prove itself.
  const fresh =
    Math.exp(-ageHours / 48) * 1.2 + (c.viewsCount < 30 ? 0.4 * (1 - c.viewsCount / 30) : 0);

  let penalty = 0;
  const seen = ctx.seen.get(c.id);
  if (seen) {
    const daysSince = (ctx.now.getTime() - seen.lastViewedAt.getTime()) / 86_400_000;
    // Fades over ~a week, but the +1 floor keeps already-watched posts below unseen ones of
    // similar merit for good — favourites only resurface once the unseen pool runs dry.
    penalty += (seen.skipped ? 5 : 3) * Math.exp(-daysSince / 7) + 1;
  }
  if (ctx.viewerId && c.userId === ctx.viewerId) penalty += 2;

  const follow = ctx.following.has(c.userId) ? 1 : 0;
  const country = ctx.viewerCountry && c.authorCountry === ctx.viewerCountry ? 0.25 : 0;
  const noise = rand() * 0.4;

  const score =
    maturity * aff * 1.4 +
    follow +
    quality * (1 - 0.4 * maturity) +
    fresh +
    country -
    penalty +
    noise;
  const exploreScore = quality + fresh - 0.6 * Math.max(0, aff) - penalty + noise * 2;

  const artistFeature = features.find(([f]) => f.startsWith("artist:"));
  return { c, score, exploreScore, artist: artistFeature ? artistFeature[0] : null };
}

/** Penalty for repeating what was just shown — the same creator twice in a row kills a feed. */
function diversityPenalty(s: Scored, picked: Scored[]): number {
  let pen = 0;
  const recent = picked.slice(-4);
  for (let i = 0; i < recent.length; i++) {
    const p = recent[i];
    const distance = recent.length - i; // 1 = immediately before
    // Back-to-back same creator costs more than any profile match can earn (affinity tops out
    // around +3), so it only happens when there's genuinely nothing else left.
    if (p.c.userId === s.c.userId) pen += distance === 1 ? 4 : 1.5 / distance;
    if (s.c.karaokeTrackId && p.c.karaokeTrackId === s.c.karaokeTrackId) pen += 0.6 / distance;
    else if (s.artist && p.artist === s.artist) pen += 0.4 / distance;
    if (s.c.category && p.c.category === s.c.category) pen += 0.2 / distance;
  }
  return pen;
}

const EXPLORE_EVERY = 5;

/** Picks and orders up to `limit` posts from `candidates` for this viewer. */
export function rankPosts(
  candidates: RankCandidate[],
  ctx: RankContext,
  limit: number,
): RankCandidate[] {
  const rand = ctx.random ?? Math.random;
  // How much the profile is trusted: none for a brand-new user (pure quality + freshness),
  // fully after ~25 watched posts.
  const maturity = Math.min(1, ctx.watchedCount / 25);
  const pool = candidates.map((c) => scoreCandidate(c, ctx, maturity, rand));
  const picked: Scored[] = [];

  while (picked.length < limit && pool.length > 0) {
    // Discovery slot — only once there's an actual profile to step outside of.
    const explore = maturity > 0.2 && picked.length % EXPLORE_EVERY === EXPLORE_EVERY - 1;
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      const val = (explore ? s.exploreScore : s.score) - diversityPenalty(s, picked);
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    picked.push(pool[bestIdx]);
    pool.splice(bestIdx, 1);
  }
  return picked.map((s) => s.c);
}
