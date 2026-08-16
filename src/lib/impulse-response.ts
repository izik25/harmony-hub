/**
 * Synthesizes a decaying-noise impulse response for convolution reverb — no async IR loading
 * required. Kept short and fast-decaying (a small room/plate, not a hall): a longer tail here
 * reads as a distinct slapback echo rather than ambience once it's mixed back with the dry vocal,
 * which is what the default reverb send in studio.tsx was doing at the old 2.5s/decay-2.2 setting.
 *
 * Two more things separate this from plain filtered noise, which is what it was before and reads
 * as a metallic "digital hiss" tail: (1) a short pre-delay (silence before the tail starts) so the
 * reverb reads as the room responding to the voice, not as an immediate doubling of it — zero
 * pre-delay is a big part of why reverb sends get misheard as echo; (2) the noise is progressively
 * low-pass filtered as it decays, since in any real room high frequencies lose energy to air/
 * surfaces faster than lows — a tail that stays full-bandwidth all the way to silence is what
 * makes synthesized reverb sound papery/artificial next to a real room.
 */
export function generateImpulseResponse(
  context: BaseAudioContext,
  duration = 1.3,
  decay = 3.2,
  preDelaySeconds = 0.015,
): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const preDelaySamples = Math.min(length - 1, Math.floor(rate * preDelaySeconds));
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      if (i < preDelaySamples) {
        data[i] = 0;
        continue;
      }
      const t = (i - preDelaySamples) / (length - preDelaySamples);
      const envelope = Math.pow(1 - t, decay);
      const raw = (Math.random() * 2 - 1) * envelope;
      // One-pole lowpass whose smoothing grows with t: alpha near 1 early (nearly full-bandwidth,
      // like an early reflection) down to ~0.15 late (dark, damped tail).
      const alpha = 1 - t * 0.85;
      lp += (raw - lp) * alpha;
      data[i] = lp;
    }
  }
  return buffer;
}
