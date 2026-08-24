/**
 * Encodes an AudioBuffer as a 24-bit PCM WAV Blob — used to export every processed take (Studio's
 * mastering export, the record-page auto-mix, and the section-fix splice tool). 24-bit rather than
 * 16: quantization noise floor drops from 16-bit's ~-96dBFS to ~-144dBFS, which matters specifically
 * because these buffers have already been through a gain-riding chain (auto-leveling, makeup gain,
 * a limiter) — 16-bit truncation of that already-processed signal is exactly where dither-less
 * quantization artifacts would be most audible, on a final "mastered" export instead of the raw
 * capture. Cost is purely file size (50% bigger than 16-bit for the same duration/channel count),
 * which these mono, minutes-long vocal takes comfortably absorb.
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 3;
  const blockAlign = numChannels * bytesPerSample;
  const numFrames = buffer.length;
  const dataSize = numFrames * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: numChannels }, (_, ch) => buffer.getChannelData(ch));
  let offset = 44;
  const maxInt = 0x7fffff; // 2^23 - 1
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const intSample = Math.round(sample * (sample < 0 ? maxInt + 1 : maxInt));
      view.setUint8(offset, intSample & 0xff);
      view.setUint8(offset + 1, (intSample >> 8) & 0xff);
      view.setUint8(offset + 2, (intSample >> 16) & 0xff);
      offset += 3;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}
