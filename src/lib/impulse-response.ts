/**
 * Synthesizes a decaying-noise impulse response for convolution reverb — no async IR loading
 * required. Kept short and fast-decaying (a small room/plate, not a hall): a longer tail here
 * reads as a distinct slapback echo rather than ambience once it's mixed back with the dry vocal,
 * which is what the default reverb send in studio.tsx was doing at the old 2.5s/decay-2.2 setting.
 */
export function generateImpulseResponse(
  context: BaseAudioContext,
  duration = 1.3,
  decay = 3.2,
): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}
