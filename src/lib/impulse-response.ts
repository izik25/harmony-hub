/**
 * Synthesizes a stereo vocal-plate impulse response for convolution reverb — no async IR loading.
 *
 * What makes it read as a plate rather than "filtered noise":
 *  - exponential decay to −60dB at the RT60 asked for (how real tails die away), not a curve that
 *    sags over the buffer's length;
 *  - frequency-dependent decay, three bands: lows ring ~10% longer than the mids and highs die in
 *    ~55% of the time — in any real plate or room the top end is absorbed first, and a tail that
 *    stays full-bandwidth to the end is what makes synthetic reverb sound papery and hissy;
 *  - dense from the first millisecond (a plate has no discrete early echoes), with a 5ms fade-in so
 *    the onset doesn't click;
 *  - independent noise per channel, so the tail is fully decorrelated left/right — it spreads wide
 *    around the voice instead of piling up in the center on top of it;
 *  - pre-delay (silence before the tail) so each word's consonant lands dry and in front, and the
 *    reverb reads as space behind the voice rather than a smear over it.
 *
 * Seeded, not Math.random(): AI mastering measures the reverb in one render and sets the send from
 * it, so every render of the same settings has to produce the same tail.
 */
export function generateImpulseResponse(
  context: BaseAudioContext,
  rt60Seconds = 1.0,
  preDelaySeconds = 0.03,
): AudioBuffer {
  const rate = context.sampleRate;
  const preDelay = Math.floor(rate * preDelaySeconds);
  const tail = Math.floor(rate * rt60Seconds * 1.1);
  const length = Math.max(2, preDelay + tail);
  const buffer = context.createBuffer(2, length, rate);
  const fadeIn = Math.max(1, Math.floor(rate * 0.005));
  const fadeOut = Math.floor(rate * 0.05);
  // ln(1000) = 6.91: amplitude down 60dB after rt seconds.
  const decayPerSample = (rt: number) => Math.exp(-6.91 / (rt * rate));
  const lowDecay = decayPerSample(rt60Seconds * 1.1);
  const midDecay = decayPerSample(rt60Seconds);
  const highDecay = decayPerSample(rt60Seconds * 0.55);
  const onePole = (hz: number) => 1 - Math.exp((-2 * Math.PI * hz) / rate);
  const aLow = onePole(500);
  const aHigh = onePole(4000);

  for (let channel = 0; channel < 2; channel++) {
    const random = mulberry32(0x5eed + channel * 7919);
    const data = buffer.getChannelData(channel);
    let lp500 = 0;
    let lp4k = 0;
    let gLow = 1;
    let gMid = 1;
    let gHigh = 1;
    for (let i = 0; i < tail; i++) {
      const x = random() * 2 - 1;
      lp500 += (x - lp500) * aLow;
      lp4k += (x - lp4k) * aHigh;
      let y = lp500 * gLow + (lp4k - lp500) * gMid + (x - lp4k) * gHigh;
      gLow *= lowDecay;
      gMid *= midDecay;
      gHigh *= highDecay;
      if (i < fadeIn) y *= i / fadeIn;
      if (i > tail - fadeOut) y *= (tail - i) / fadeOut;
      data[preDelay + i] = y;
    }
  }
  return buffer;
}

/** Small, fast seeded PRNG (uniform in [0, 1)). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
