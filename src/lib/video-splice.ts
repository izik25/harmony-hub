import { pickSupportedMimeType } from "./video-synthesis";

/**
 * Video-level analogue of audio-splice.ts's pause/rewind/fix operations, with the same three-
 * function shape (commitCheckpoint/trimCheckpoint/replaceSegment) so callers can use either
 * module interchangeably. Web Audio gives audio-splice.ts a cheap in-memory buffer to
 * slice/concatenate — instant and lossless. There's no equivalent primitive for video, so this
 * plays each source segment through a <canvas> + Web Audio graph (the same technique already
 * proven in video-synthesis.ts's renderCoverVideo) and re-records the result with MediaRecorder.
 * That makes every operation here playback-bound (roughly as slow as the video being processed)
 * and a lossy re-encode — both acceptable at this app's actual capture resolution (record.tsx
 * caps the selfie camera around 480px wide), but a real difference from the instant audio path.
 */

type Segment = { blob: Blob; startAt?: number; endAt?: number };

async function loadVideo(blob: Blob): Promise<{ video: HTMLVideoElement; url: string }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.src = url;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("videoSpliceLoadFailed")), {
      once: true,
    });
  });
  return { video, url };
}

async function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (Math.abs(video.currentTime - seconds) < 0.01) return;
  video.currentTime = seconds;
  await new Promise<void>((resolve) => {
    video.addEventListener("seeked", () => resolve(), { once: true });
  });
}

async function captureSequence(segments: Segment[]): Promise<{ blob: Blob; seconds: number }> {
  if (segments.length === 0) throw new Error("videoSpliceEmpty");

  const loaded = await Promise.all(segments.map((s) => loadVideo(s.blob)));
  const width = loaded[0].video.videoWidth || 480;
  const height = loaded[0].video.videoHeight || 854;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("videoSynthCanvasUnavailable");

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  // Every source stays connected for the whole session — only one is ever actually playing
  // (the rest are paused/not-yet-started), so there's no mixing/overlap to worry about.
  const sources = loaded.map(({ video }) => {
    const source = audioCtx.createMediaElementSource(video);
    source.connect(dest);
    return source;
  });

  const canvasStream = (
    canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }
  ).captureStream(30);
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  let raf = 0;
  let activeVideo: HTMLVideoElement | null = null;
  const drawFrame = () => {
    if (activeVideo) ctx.drawImage(activeVideo, 0, 0, width, height);
    raf = requestAnimationFrame(drawFrame);
  };

  await audioCtx.resume();
  let totalSeconds = 0;

  try {
    for (let i = 0; i < loaded.length; i++) {
      const { video } = loaded[i];
      const seg = segments[i];
      const startAt = seg.startAt ?? 0;
      activeVideo = video;
      await seekTo(video, startAt);
      await video.play();
      // Start the recorder right as the first frame is actually about to play, rather than at
      // the top of this function — minimizes any blank/dead leading time in the output.
      if (i === 0) {
        recorder.start();
        drawFrame();
      }
      await new Promise<void>((resolve) => {
        const stopAt = seg.endAt;
        const onEnded = () => resolve();
        video.addEventListener("ended", onEnded, { once: true });
        if (stopAt == null) return;
        const onTime = () => {
          if (video.currentTime >= stopAt) {
            video.removeEventListener("timeupdate", onTime);
            video.removeEventListener("ended", onEnded);
            resolve();
          }
        };
        video.addEventListener("timeupdate", onTime);
      });
      video.pause();
      totalSeconds += Math.max(0, video.currentTime - startAt);
    }
  } finally {
    cancelAnimationFrame(raf);
    recorder.stop();
    sources.forEach((s) => s.disconnect());
    await audioCtx.close();
    loaded.forEach(({ url }) => URL.revokeObjectURL(url));
  }

  const blob = await stopped;
  return { blob, seconds: totalSeconds };
}

/** Folds `newBlob` onto the end of `baseBlob` (or just re-encodes it if there's no base yet). */
export async function commitCheckpoint(
  baseBlob: Blob | null,
  newBlob: Blob,
): Promise<{ blob: Blob; seconds: number }> {
  return captureSequence(baseBlob ? [{ blob: baseBlob }, { blob: newBlob }] : [{ blob: newBlob }]);
}

/** Cuts a committed take back to `toSeconds`, discarding everything after it. */
export async function trimCheckpoint(
  baseBlob: Blob,
  toSeconds: number,
): Promise<{ blob: Blob; seconds: number }> {
  return captureSequence([{ blob: baseBlob, endAt: toSeconds }]);
}

/**
 * Replaces the [startSeconds, endSeconds) window of an already-finished take with a freshly
 * recorded segment, keeping everything before and after untouched — the video side of Studio's
 * Fix a Section.
 */
export async function replaceSegment(
  baseBlob: Blob,
  startSeconds: number,
  endSeconds: number,
  segmentBlob: Blob,
): Promise<{ blob: Blob; seconds: number }> {
  return captureSequence([
    { blob: baseBlob, endAt: startSeconds },
    { blob: segmentBlob },
    { blob: baseBlob, startAt: endSeconds },
  ]);
}
