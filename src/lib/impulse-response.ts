/** Synthesizes a decaying-noise impulse response for convolution reverb — no async IR loading required. */
export function generateImpulseResponse(
  context: BaseAudioContext,
  duration = 2.5,
  decay = 2.2,
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
