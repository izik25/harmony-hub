import { pickSupportedMimeType } from "./video-synthesis";

/**
 * Opens the user-facing selfie camera — a small picture-in-picture self-view over whatever else
 * is on screen (karaoke video during recording, the raw take during a Fix a Section punch-in),
 * not the main subject, hence the modest requested resolution.
 */
export async function openSelfieCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 480 } },
  });
}

/**
 * Combines a mic-only audio stream (record.tsx's/FixSectionEditor's own getUserMedia capture)
 * with a camera video stream into one MediaRecorder, using whichever video mimetype/codec this
 * browser actually supports (see pickSupportedMimeType, shared with video-synthesis.ts).
 */
export function buildCombinedRecorder(
  micStream: MediaStream,
  camStream: MediaStream,
): { recorder: MediaRecorder; mimeType: string } {
  const combined = new MediaStream([...camStream.getVideoTracks(), ...micStream.getAudioTracks()]);
  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
  });
  return { recorder, mimeType };
}
