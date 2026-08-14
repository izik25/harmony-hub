// Turns a post's (audio, cover art, title) into a vertical video file — YouTube Shorts, TikTok and
// Instagram Reels all require actual video, but SONA recordings are audio-only. Renders a canvas
// frame (cover art + title) at 30fps, muxes it with the real decoded audio via MediaRecorder, and
// resolves a Blob ready to upload. Runs entirely in the browser; nothing here touches the server.
//
// Format note: Instagram's Graph API only accepts MP4 (H.264/AAC). Chromium-based browsers can
// record MediaRecorder output directly as MP4; Firefox/Safari can't, and fall back to WebM, which
// YouTube/TikTok accept but Instagram does not — callers should surface that as a real limitation
// ("open this in Chrome to publish to Instagram") rather than a bug.
const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const MAX_DURATION_SECONDS = 60;

export type VideoSynthesisResult = { blob: Blob; mimeType: string; isMp4: boolean };

function pickSupportedMimeType(): string {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  startY: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (ctx.measureText(trial).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  lines.slice(0, 3).forEach((line, i) => ctx.fillText(line, centerX, startY + i * lineHeight));
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function renderCoverVideo(params: {
  audioUrl: string;
  coverUrl: string;
  title: string;
  hue: number;
}): Promise<VideoSynthesisResult> {
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.src = params.audioUrl;
  await new Promise<void>((resolve, reject) => {
    audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
    audio.addEventListener("error", () => reject(new Error("videoSynthAudioLoadFailed")), {
      once: true,
    });
  });

  const cover = await loadImage(params.coverUrl);

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaElementSource(audio);
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("videoSynthCanvasUnavailable");

  const hue = params.hue;
  const drawFrame = () => {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    grad.addColorStop(0, `hsl(${hue} 60% 12%)`);
    grad.addColorStop(1, `hsl(${(hue + 40) % 360} 55% 6%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const size = 820;
    const x = (CANVAS_WIDTH - size) / 2;
    const y = 340;
    ctx.save();
    roundRectPath(ctx, x, y, size, size, 48);
    ctx.clip();
    if (cover) {
      ctx.drawImage(cover, x, y, size, size);
    } else {
      ctx.fillStyle = `hsl(${hue} 70% 30%)`;
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "bold 64px system-ui, sans-serif";
    wrapText(ctx, params.title || "SONA", CANVAS_WIDTH / 2, y + size + 140, CANVAS_WIDTH - 140, 78);

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "600 34px system-ui, sans-serif";
    ctx.fillText("SONA", CANVAS_WIDTH / 2, CANVAS_HEIGHT - 90);
  };

  const canvasStream = (
    canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }
  ).captureStream(30);
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  let raf = 0;
  const tick = () => {
    drawFrame();
    raf = requestAnimationFrame(tick);
  };

  await audioCtx.resume();
  recorder.start();
  tick();
  audio.currentTime = 0;
  await audio.play();

  await Promise.race([
    new Promise<void>((resolve) =>
      audio.addEventListener("ended", () => resolve(), { once: true }),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, MAX_DURATION_SECONDS * 1000)),
  ]);

  cancelAnimationFrame(raf);
  recorder.stop();
  audio.pause();
  source.disconnect();
  await audioCtx.close();

  const blob = await stopped;
  return { blob, mimeType, isMp4: mimeType.startsWith("video/mp4") };
}
