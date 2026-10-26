/**
 * The short vocal-plate reverb on the live "hear yourself" monitor — the same thing a studio puts
 * in a singer's headphones so their voice sounds like it's in a room instead of bone-dry and
 * right inside their head. Only ever heard in the monitor: the take itself is recorded dry.
 *
 * The impulse response is synthesized rather than shipped as a file: decorrelated noise per
 * channel (so the tail is wide), an exponential decay, and a lowpass that slides down as it decays
 * — the way a real plate/room loses its highs first — so the tail stays smooth, not hissy.
 * ConvolverNode's default normalization evens out its level, so the send gain alone sets how wet
 * it is. It runs on a parallel send, so whatever buffering the convolver has only acts as
 * pre-delay — the dry voice stays exactly as immediate as before.
 */
export function createVocalPlate(ctx: BaseAudioContext, seconds = 1.6): AudioBuffer {
  const rate = ctx.sampleRate;
  const preDelay = Math.round(rate * 0.01);
  const length = preDelay + Math.round(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  const rt60 = seconds * 0.9;
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / rate;
      const cutoff = 1800 + 5200 * Math.exp(-t / 0.35); // ~7kHz at the start, ~2kHz in the tail
      lp += (Math.random() * 2 - 1 - lp) * (1 - Math.exp((-2 * Math.PI * cutoff) / rate));
      const decay = Math.pow(10, (-3 * t) / rt60); // -60dB over rt60
      data[i] = lp * decay * Math.min(1, t / 0.004);
    }
  }
  return buffer;
}
