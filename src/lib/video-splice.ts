import { pickSupportedMimeType, roundRectPath } from "./video-synthesis";

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

// Fixed vertical export resolution for the published performance video — independent of both the
// selfie camera's own (much smaller, record.tsx caps it ~480px wide) capture resolution and the
// karaoke clip's native size, so the composite reads the same regardless of what either source
// happened to record at.
const PERFORMANCE_WIDTH = 1080;
const PERFORMANCE_HEIGHT = 1920;

// Mirrors the self-preview box record.tsx's live full-screen stage draws at `top-20 end-3 h-32
// w-24` on its ~393px-wide mobile viewport — scaled up to this export's fixed resolution — so the
// published video reproduces the same picture-in-picture layout the singer actually saw and
// recorded against, not an arbitrarily different one.
const PIP_WIDTH = 260;
const PIP_HEIGHT = 345;
const PIP_TOP = 170;
const PIP_RIGHT = 40;
const PIP_RADIUS = 28;

/**
 * Builds the actual publish-ready performance video: the karaoke backing video (lyrics baked in)
 * full-frame — the same object-contain-over-a-blurred-backdrop treatment record.tsx's live stage
 * uses — with the selfie camera composited on top as a picture-in-picture overlay in the same
 * corner, and the take's final mixed vocal+backing audio (never either source's own raw track) as
 * the soundtrack. Without this, a camera take's own MediaRecorder output only ever carries the
 * bare cropped selfie clip and its own dry, unprocessed mic audio — never the backing video the
 * viewer needs to see the lyrics against, and never the properly balanced mix. This has to run as
 * its own step, separate from the live recording (record.tsx) and from Fix a Section
 * (FixSectionEditor.tsx / this module's replaceSegment), both of which still operate on the plain
 * selfie-only footage so punch-ins stay simple splices — compositing only makes sense once, after
 * every edit is done, right before the take is actually published.
 */
export async function renderPerformanceVideo(params: {
  cameraBlob: Blob;
  backingVideoUrl: string;
  mixedAudioBlob: Blob;
}): Promise<Blob> {
  const { video: camVideo, url: camUrl } = await loadVideo(params.cameraBlob);
  camVideo.muted = true;

  // Loaded directly from its served URL (not re-fetched into a blob first) — same as
  // video-synthesis.ts's cover-image loader, and the karaoke storage already serves these
  // cross-origin-readable (sync-karaoke.ts puts them on Vercel Blob's public storage, or a
  // same-origin /karaoke/files/ path), which drawImage()-ing a video frame onto a canvas requires
  // to avoid tainting it.
  const backingVideo = document.createElement("video");
  backingVideo.crossOrigin = "anonymous";
  backingVideo.muted = true;
  backingVideo.playsInline = true;
  backingVideo.src = params.backingVideoUrl;
  await new Promise<void>((resolve, reject) => {
    backingVideo.addEventListener("loadedmetadata", () => resolve(), { once: true });
    backingVideo.addEventListener(
      "error",
      () => reject(new Error("videoSpliceBackingLoadFailed")),
      { once: true },
    );
  });

  const audioCtx = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(await params.mixedAudioBlob.arrayBuffer());
  } catch (err) {
    await audioCtx.close();
    throw err;
  }
  const dest = audioCtx.createMediaStreamDestination();
  const audioSource = audioCtx.createBufferSource();
  audioSource.buffer = audioBuffer;
  audioSource.connect(dest);

  const canvas = document.createElement("canvas");
  canvas.width = PERFORMANCE_WIDTH;
  canvas.height = PERFORMANCE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("videoSynthCanvasUnavailable");

  const pipX = PERFORMANCE_WIDTH - PIP_RIGHT - PIP_WIDTH;

  const drawContain = (video: HTMLVideoElement) => {
    if (!video.videoWidth || !video.videoHeight) return;
    const coverScale = Math.max(
      PERFORMANCE_WIDTH / video.videoWidth,
      PERFORMANCE_HEIGHT / video.videoHeight,
    );
    const bw = video.videoWidth * coverScale;
    const bh = video.videoHeight * coverScale;
    ctx.filter = "blur(36px)";
    ctx.drawImage(video, (PERFORMANCE_WIDTH - bw) / 2, (PERFORMANCE_HEIGHT - bh) / 2, bw, bh);
    ctx.filter = "none";

    const containScale = Math.min(
      PERFORMANCE_WIDTH / video.videoWidth,
      PERFORMANCE_HEIGHT / video.videoHeight,
    );
    const cw = video.videoWidth * containScale;
    const ch = video.videoHeight * containScale;
    ctx.drawImage(video, (PERFORMANCE_WIDTH - cw) / 2, (PERFORMANCE_HEIGHT - ch) / 2, cw, ch);
  };

  const drawPip = (video: HTMLVideoElement) => {
    if (!video.videoWidth || !video.videoHeight) return;
    ctx.save();
    roundRectPath(ctx, pipX, PIP_TOP, PIP_WIDTH, PIP_HEIGHT, PIP_RADIUS);
    ctx.clip();
    const scale = Math.max(PIP_WIDTH / video.videoWidth, PIP_HEIGHT / video.videoHeight);
    const vw = video.videoWidth * scale;
    const vh = video.videoHeight * scale;
    ctx.drawImage(video, pipX + (PIP_WIDTH - vw) / 2, PIP_TOP + (PIP_HEIGHT - vh) / 2, vw, vh);
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, pipX, PIP_TOP, PIP_WIDTH, PIP_HEIGHT, PIP_RADIUS);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.restore();
  };

  const canvasStream = (
    canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }
  ).captureStream(30);
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  let raf = 0;
  const drawFrame = () => {
    drawContain(backingVideo);
    drawPip(camVideo);
    raf = requestAnimationFrame(drawFrame);
  };

  try {
    await audioCtx.resume();
    await Promise.all([seekTo(camVideo, 0), seekTo(backingVideo, 0)]);
    await Promise.all([camVideo.play(), backingVideo.play()]);
    recorder.start();
    audioSource.start(0);
    drawFrame();

    await new Promise<void>((resolve) => {
      // The karaoke clip can be shorter than the take (a short backing loop under a longer
      // performance) — loop it back to the top instead of freezing on its last frame for
      // whatever's left, exactly like the live stage would keep looping.
      const onBackingEnded = () => {
        if (camVideo.ended) return;
        backingVideo.currentTime = 0;
        backingVideo.play().catch(() => {});
      };
      backingVideo.addEventListener("ended", onBackingEnded);
      camVideo.addEventListener(
        "ended",
        () => {
          backingVideo.removeEventListener("ended", onBackingEnded);
          resolve();
        },
        { once: true },
      );
    });
  } finally {
    cancelAnimationFrame(raf);
    backingVideo.pause();
    try {
      audioSource.stop();
    } catch {
      // already stopped/never started — nothing to clean up
    }
    recorder.stop();
    await audioCtx.close();
    URL.revokeObjectURL(camUrl);
  }

  return stopped;
}
