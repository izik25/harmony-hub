import { audioBufferToWavBlob } from "./wav-encoder";

/**
 * Sample-accurate editing for the record screen's rewind-and-punch-in flow: folding a newly
 * captured segment onto whatever was already committed, or cutting a committed take back to an
 * earlier point. Both go through decode → edit → re-encode as WAV rather than touching the raw
 * WebM bytes, because a MediaRecorder chunk stream can only be decoded from a fresh recorder
 * instance — there's no way to splice two independently-muxed WebM blobs together directly. The
 * mic is always requested mono (see record.tsx), so this only ever needs to handle 1 channel.
 */

async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await ctx.close();
  }
}

function sliceBuffer(buffer: AudioBuffer, toSeconds: number): AudioBuffer {
  const frames = Math.max(1, Math.min(buffer.length, Math.round(toSeconds * buffer.sampleRate)));
  const out = new AudioBuffer({
    length: frames,
    numberOfChannels: 1,
    sampleRate: buffer.sampleRate,
  });
  out.copyToChannel(buffer.getChannelData(0).subarray(0, frames), 0);
  return out;
}

function concatBuffers(a: AudioBuffer | null, b: AudioBuffer): AudioBuffer {
  if (!a) return b;
  const out = new AudioBuffer({
    length: a.length + b.length,
    numberOfChannels: 1,
    sampleRate: a.sampleRate,
  });
  const data = out.getChannelData(0);
  data.set(a.getChannelData(0), 0);
  data.set(b.getChannelData(0), a.length);
  return out;
}

/**
 * Folds `newBlob` onto the end of `baseBlob` (or just decodes it if there's no base yet) and
 * re-encodes the result as one WAV. Used every time the live recorder is stopped to freeze a
 * checkpoint — pausing, scrubbing, or finishing all go through this.
 */
export async function commitCheckpoint(
  baseBlob: Blob | null,
  newBlob: Blob,
): Promise<{ blob: Blob; seconds: number }> {
  const newBuffer = await decodeBlob(newBlob);
  const baseBuffer = baseBlob ? await decodeBlob(baseBlob) : null;
  const combined = concatBuffers(baseBuffer, newBuffer);
  return { blob: audioBufferToWavBlob(combined), seconds: combined.duration };
}

/** Cuts a committed take back to `toSeconds`, discarding everything after it. */
export async function trimCheckpoint(
  baseBlob: Blob,
  toSeconds: number,
): Promise<{ blob: Blob; seconds: number }> {
  const buffer = await decodeBlob(baseBlob);
  const trimmed = sliceBuffer(buffer, toSeconds);
  return { blob: audioBufferToWavBlob(trimmed), seconds: trimmed.duration };
}
