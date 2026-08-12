import { audioBufferToWavBlob } from "./wav-encoder";

const FETCH_TIMEOUT_MS = 10_000;
const RENDER_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Attenuates (not silences — a hard cut sounds choppier than a gentle dip) whatever's below the
 * threshold, with a short attack and a slower release so it doesn't chop the tails off words.
 * On phones especially, the backing track playing out of the speaker leaks straight into the
 * mic — that bleed sits in the gaps between phrases, and this is what actually cleans those up.
 * Nothing here can remove bleed that overlaps the voice itself; see the volume ducking and
 * headphone hint in record.tsx for that half of the fix.
 */
function applyNoiseGate(
  buffer: AudioBuffer,
  thresholdDb = -42,
  attackMs = 4,
  releaseMs = 180,
  floorGain = 0.12,
): void {
  const thresholdLinear = 10 ** (thresholdDb / 20);
  const sampleRate = buffer.sampleRate;
  const attackSamples = Math.max(1, Math.floor((attackMs / 1000) * sampleRate));
  const releaseSamples = Math.max(1, Math.floor((releaseMs / 1000) * sampleRate));
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.02)); // 20ms short-time RMS window

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    const n = data.length;
    let sumSquares = 0;
    let currentGain = 1;
    for (let i = 0; i < n; i++) {
      const sample = data[i];
      sumSquares += sample * sample;
      if (i >= windowSize) sumSquares -= data[i - windowSize] * data[i - windowSize];
      const rms = Math.sqrt(sumSquares / Math.min(i + 1, windowSize));

      const targetGain = rms >= thresholdLinear ? 1 : floorGain;
      const step = targetGain > currentGain ? attackSamples : releaseSamples;
      currentGain += (targetGain - currentGain) / step;
      data[i] = sample * currentGain;
    }
  }
}

/**
 * Turns a raw mic recording into a clean, studio-style take: cuts low-frequency rumble/hum,
 * lifts vocal presence, evens out levels with a compressor + makeup gain, then runs everything
 * through a limiter so the boost never turns into clipping/distortion — and, if a karaoke
 * backing track was used, blends it in underneath. This runs entirely offline
 * (OfflineAudioContext), rendering sample-accurately from decoded buffers rather than mixing two
 * live streams in real time. Live mixing of independently-clocked sources (mic + a playing
 * <video>) is exactly what produces audible clicks/glitches at buffer boundaries; rendering
 * offline from fixed buffers has none of that — the result is deterministic and glitch-free.
 *
 * The backing-track fetch and the render itself are both time-boxed: a stalled network request
 * or a stuck render would otherwise leave the caller waiting forever with nothing to fall back
 * to (Save staying disabled indefinitely looks, to the user, exactly like "it won't let me
 * save").
 */
export async function processRecording(
  micBlob: Blob,
  backingTrackUrl?: string | null,
): Promise<Blob> {
  const decodeCtx = new AudioContext();
  let micBuffer: AudioBuffer;
  let backingBuffer: AudioBuffer | null = null;
  try {
    micBuffer = await decodeCtx.decodeAudioData(await micBlob.arrayBuffer());
    if (backingTrackUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(backingTrackUrl, { signal: controller.signal }).finally(() =>
          clearTimeout(timer),
        );
        backingBuffer = await decodeCtx.decodeAudioData(await res.arrayBuffer());
      } catch {
        backingBuffer = null; // proceed vocal-only rather than failing the whole recording
      }
    }
  } finally {
    await decodeCtx.close();
  }

  applyNoiseGate(micBuffer);

  const sampleRate = micBuffer.sampleRate;
  const duration = micBuffer.duration;
  const offlineCtx = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(duration * sampleRate)),
    sampleRate,
  );

  const micSource = offlineCtx.createBufferSource();
  micSource.buffer = micBuffer;

  const highpass = offlineCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 100; // cuts rumble/hum without touching the voice

  const presence = offlineCtx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3000;
  presence.Q.value = 1;
  presence.gain.value = 3; // gentle clarity/intelligibility lift, not a full EQ makeover

  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  const makeupGain = offlineCtx.createGain();
  makeupGain.gain.value = 1.4;

  // Final limiter on the whole bus (vocal + backing track together) — catches anything the
  // makeup gain pushes over 0dB so loudness never turns into hard digital clipping.
  const limiter = offlineCtx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  limiter.connect(offlineCtx.destination);

  micSource.connect(highpass).connect(presence).connect(compressor).connect(makeupGain);
  makeupGain.connect(limiter);
  micSource.start(0);

  if (backingBuffer) {
    const backingSource = offlineCtx.createBufferSource();
    backingSource.buffer = backingBuffer;
    const backingGain = offlineCtx.createGain();
    backingGain.gain.value = 0.65; // sits under the vocal instead of drowning it out
    backingSource.connect(backingGain).connect(limiter);
    backingSource.start(0, 0, Math.min(duration, backingBuffer.duration));
  }

  const rendered = await withTimeout(
    offlineCtx.startRendering(),
    RENDER_TIMEOUT_MS,
    "Offline render",
  );
  return audioBufferToWavBlob(rendered);
}
