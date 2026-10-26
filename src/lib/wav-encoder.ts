/**
 * Encodes an AudioBuffer as a PCM WAV Blob — used to export every processed take (Studio's
 * mastering export, the record-page auto-mix, and the section-fix splice tool).
 *
 * 24-bit by default, for intermediate files that may be processed further: its quantization floor
 * (~−144dBFS) stays far below anything a later gain stage could lift into audibility.
 *
 * 16-bit for finished, mastered mixes — the CD/streaming delivery format. At −14 LUFS its ~−96dBFS
 * floor is inaudible as long as it's dithered: TPDF dither (the sum of two uniform random values,
 * ±1 LSB) turns truncation distortion on quiet tails into a constant, benign hiss far below the
 * music. That keeps a stereo master the same size a mono 24-bit file was, well inside the upload cap.
 */
export function audioBufferToWavBlob(buffer: AudioBuffer, bitDepth: 16 | 24 = 24): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = bitDepth / 8;
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
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: numChannels }, (_, ch) => buffer.getChannelData(ch));
  let offset = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const dither = Math.random() - Math.random();
        const intSample = Math.round(channels[ch][i] * 32767 + dither);
        view.setInt16(offset, Math.max(-32768, Math.min(32767, intSample)), true);
        offset += 2;
      }
    }
    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

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
