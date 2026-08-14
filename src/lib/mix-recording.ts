import { audioBufferToWavBlob } from "./wav-encoder";
import { generateImpulseResponse } from "./impulse-response";

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

type SignalProfile = {
  noiseFloorDb: number;
  vocalLevelDb: number;
};

/**
 * Measures this specific take's actual noise floor and typical singing level from real
 * short-window RMS data, instead of assuming every recording behaves the same. The gate's
 * threshold and the auto-leveling gain below are both derived from these numbers, so a quiet
 * room and a noisy one — or a soft singer and a loud one — each get treated for what they
 * actually are rather than run through one fixed setting regardless of content.
 */
function analyzeSignal(buffer: AudioBuffer): SignalProfile {
  const data = buffer.getChannelData(0);
  const windowSize = Math.max(1, Math.floor(buffer.sampleRate * 0.02)); // 20ms windows
  const windowDb: number[] = [];
  for (let i = 0; i < data.length; i += windowSize) {
    const end = Math.min(data.length, i + windowSize);
    let sumSquares = 0;
    for (let j = i; j < end; j++) sumSquares += data[j] * data[j];
    const rms = Math.sqrt(sumSquares / (end - i));
    windowDb.push(rms > 0 ? 20 * Math.log10(rms) : -100);
  }
  windowDb.sort((a, b) => a - b);
  const percentile = (p: number) => windowDb[Math.floor(p * (windowDb.length - 1))] ?? -100;
  return {
    noiseFloorDb: percentile(0.1), // quietest tenth of the take — the room/hiss floor between phrases
    vocalLevelDb: percentile(0.85), // near the loud end without being skewed by rare transient peaks
  };
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
  thresholdDb: number,
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
 * Turns a raw mic recording into a clean, studio-style take instead of the thin, boxy, dead-dry
 * sound of a phone voice memo: analyzes the actual take first (analyzeSignal) so the noise gate's
 * threshold and the auto-leveling gain both reflect what's really in this specific recording
 * rather than one fixed setting applied to everything, then runs noise gate, rumble cut, warmth +
 * presence EQ, a de-harshing high-shelf, compression + makeup gain, a touch of room reverb, and a
 * final limiter — then, if a karaoke backing track was used, blends it in underneath. This runs
 * entirely offline (OfflineAudioContext), rendering sample-accurately from decoded buffers rather
 * than mixing two live streams in real time. Live mixing of independently-clocked sources (mic +
 * a playing <video>) is exactly what produces audible clicks/glitches at buffer boundaries;
 * rendering offline from fixed buffers has none of that — the result is deterministic and
 * glitch-free.
 *
 * The backing-track fetch and the render itself are both time-boxed: a stalled network request
 * or a stuck render would otherwise leave the caller waiting forever with nothing to fall back
 * to (Save staying disabled indefinitely looks, to the user, exactly like "it won't let me
 * save").
 */
export type MixLevels = {
  /** Multiplier on the vocal's post-compression makeup gain. 1.4 (the default) is the baseline
   * "studio" loudness the chain was tuned around; callers can scale it up/down from a UI slider. */
  vocalGain?: number;
  /** Multiplier on the backing track's level under the vocal. 0.65 is the default balance. */
  backingGain?: number;
};

export async function processRecording(
  micBlob: Blob,
  backingTrackUrl?: string | null,
  levels: MixLevels = {},
): Promise<Blob> {
  const vocalGain = levels.vocalGain ?? 1.4;
  const backingGainLevel = levels.backingGain ?? 0.65;
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

  // Analyze this take before touching it — the gate threshold and the auto-leveling gain below
  // both come from what's actually in the recording, not a fixed guess.
  const profile = analyzeSignal(micBuffer);
  const gateThresholdDb = Math.min(-25, Math.max(-55, profile.noiseFloorDb + 8));
  applyNoiseGate(micBuffer, gateThresholdDb);

  // Levels the take toward the compressor's own threshold before the caller's vocalGain
  // multiplier goes on top, so a naturally soft take and a naturally hot one both land in the
  // same ballpark instead of the same fixed multiplier under- or over-driving one of them.
  const targetVocalDb = -20;
  const autoGainDb = Math.min(12, Math.max(-6, targetVocalDb - profile.vocalLevelDb));
  const autoGainLinear = 10 ** (autoGainDb / 20);

  const sampleRate = micBuffer.sampleRate;
  const duration = micBuffer.duration;
  const reverbTailSeconds = 1.2; // room for the reverb send to decay naturally instead of being
  // cut off exactly at the end of the take
  // Mono output — the source is a solo voice take (getUserMedia requests channelCount: 1), so
  // rendering to stereo would just duplicate identical samples into a second channel, doubling
  // the WAV's byte size for zero audible benefit (and making it that much likelier to trip a
  // request-body size limit on the way to the server).
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.max(1, Math.ceil((duration + reverbTailSeconds) * sampleRate)),
    sampleRate,
  );

  const micSource = offlineCtx.createBufferSource();
  micSource.buffer = micBuffer;

  const highpass = offlineCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 100; // cuts rumble/hum without touching the voice

  // Take-specific auto-leveling from analyzeSignal above — runs before the EQ/compressor so the
  // rest of the chain always sees a consistently-leveled signal regardless of how hot or quiet
  // the raw capture came in.
  const autoGain = offlineCtx.createGain();
  autoGain.gain.value = autoGainLinear;

  // A phone mic recording on its own is thin and boxy — no low end, no space — which is exactly
  // what makes it read as "a voice message" instead of a vocal take. warmth adds a little body
  // back in; presence lifts clarity; the reverb send further down adds a touch of room instead
  // of the completely dry, right-on-the-capsule sound phone mics produce.
  const warmth = offlineCtx.createBiquadFilter();
  warmth.type = "lowshelf";
  warmth.frequency.value = 200;
  warmth.gain.value = 2.5;

  const presence = offlineCtx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3000;
  presence.Q.value = 1;
  presence.gain.value = 3; // gentle clarity/intelligibility lift, not a full EQ makeover

  const airRolloff = offlineCtx.createBiquadFilter();
  airRolloff.type = "highshelf";
  airRolloff.frequency.value = 9000;
  airRolloff.gain.value = -3; // takes the edge off harsh phone-mic sibilance/hiss

  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  const makeupGain = offlineCtx.createGain();
  makeupGain.gain.value = vocalGain;

  // Final limiter on the whole bus (vocal + reverb + backing track together) — catches anything
  // the makeup gain pushes over 0dB so loudness never turns into hard digital clipping.
  const limiter = offlineCtx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  limiter.connect(offlineCtx.destination);

  // Short, subtle room send on the vocal only — enough to feel produced, not an obvious effect.
  const reverbSend = offlineCtx.createGain();
  reverbSend.gain.value = 0.16;
  const convolver = offlineCtx.createConvolver();
  convolver.buffer = generateImpulseResponse(offlineCtx, 1.1, 3.2);
  convolver.normalize = true;

  micSource
    .connect(highpass)
    .connect(autoGain)
    .connect(warmth)
    .connect(presence)
    .connect(airRolloff)
    .connect(compressor)
    .connect(makeupGain);
  makeupGain.connect(limiter);
  makeupGain.connect(reverbSend).connect(convolver).connect(limiter);
  micSource.start(0);

  if (backingBuffer) {
    const backingSource = offlineCtx.createBufferSource();
    backingSource.buffer = backingBuffer;
    const backingGain = offlineCtx.createGain();
    backingGain.gain.value = backingGainLevel; // sits under the vocal instead of drowning it out
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
