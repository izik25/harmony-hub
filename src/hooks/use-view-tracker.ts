import { useCallback, useEffect, useRef, type RefObject } from "react";
import { recordView } from "@/functions/recommendations";

/**
 * Measures one feed impression of a post (how long it was on screen, how much of its media
 * actually played, including replays) and reports it to the recommender when the post stops
 * being the active one — scrolled away, tab hidden, or unmounted. That impression is the main
 * signal the "For You" ranking learns from (see lib/feed-ranking.ts viewSignal).
 */
export function useViewTracker(
  postId: string,
  active: boolean,
  mediaRef: RefObject<HTMLMediaElement | null>,
) {
  // start: when this impression began (0 = not currently tracking).
  const state = useRef({ start: 0, watchedMs: 0, lastTime: -1 });

  // Accumulate actually-played time from timeupdate deltas: a loop restart or a seek shows up as
  // a jump (negative or large), which is just skipped, so replays add up naturally.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const onTime = () => {
      const s = state.current;
      if (!s.start) return;
      const t = media.currentTime;
      if (s.lastTime >= 0) {
        const delta = t - s.lastTime;
        if (delta > 0 && delta < 2) s.watchedMs += delta * 1000;
      }
      s.lastTime = t;
    };
    media.addEventListener("timeupdate", onTime);
    return () => media.removeEventListener("timeupdate", onTime);
  }, [mediaRef]);

  const flush = useCallback(() => {
    const s = state.current;
    if (!s.start) return;
    const dwellMs = Date.now() - s.start;
    const media = mediaRef.current;
    const durationMs = media && Number.isFinite(media.duration) ? media.duration * 1000 : 0;
    const watchedMs = s.watchedMs;
    s.start = 0;
    s.watchedMs = 0;
    s.lastTime = -1;
    // Flashed by during a fast fling — not an impression (the server ignores these too).
    if (dwellMs < 700) return;
    recordView({
      data: {
        postId,
        watchedMs: Math.round(watchedMs),
        dwellMs: Math.round(dwellMs),
        durationMs: Math.round(durationMs),
      },
    }).catch(() => {});
  }, [postId, mediaRef]);

  useEffect(() => {
    if (!active) return;
    const begin = () => {
      state.current = { start: Date.now(), watchedMs: 0, lastTime: -1 };
    };
    begin();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else if (!state.current.start) begin();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [active, flush]);
}
