import { audioBufferToWavBlob } from "./wav-encoder";

/**
 * Turns a raw mic recording into a clean, studio-style take: cuts low-frequency rumble/hum with
 * a highpass filter, evens out levels with a compressor, and — if a karaoke backing track was
 * used — blends it in underneath. This runs entirely offline (OfflineAudioContext), rendering
 * sample-accurately from decoded buffers rather than mixing two live streams in real time. Live
 * mixing of independently-clocked sources (mic + a playing <video>) is exactly what produces
 * audible clicks/glitches at buffer boundaries; rendering offline from fixed buffers has none of
 * that — the result is deterministic and glitch-free.
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
        const res = await fetch(backingTrackUrl);
        backingBuffer = await decodeCtx.decodeAudioData(await res.arrayBuffer());
      } catch {
        backingBuffer = null; // proceed vocal-only rather than failing the whole recording
      }
    }
  } finally {
    await decodeCtx.close();
  }

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
  highpass.frequency.value = 90; // cuts rumble/hum without touching the voice
  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 24;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.2;
  const micGain = offlineCtx.createGain();
  micGain.gain.value = 1.15;
  micSource.connect(highpass).connect(compressor).connect(micGain).connect(offlineCtx.destination);
  micSource.start(0);

  if (backingBuffer) {
    const backingSource = offlineCtx.createBufferSource();
    backingSource.buffer = backingBuffer;
    const backingGain = offlineCtx.createGain();
    backingGain.gain.value = 0.65; // sits under the vocal instead of drowning it out
    backingSource.connect(backingGain).connect(offlineCtx.destination);
    backingSource.start(0, 0, Math.min(duration, backingBuffer.duration));
  }

  const rendered = await offlineCtx.startRendering();
  return audioBufferToWavBlob(rendered);
}
