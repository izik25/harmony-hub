import { runPitchJob } from "./pitch-correct";

// Worker side of analyzePitchOffThread / applyPitchCorrectionOffThread: one job in, its result
// back (corrected channels transferred, not copied — a few minutes of audio is tens of megabytes).
self.onmessage = (e: MessageEvent<Parameters<typeof runPitchJob>[0]>) => {
  const { result, transfer } = runPitchJob(e.data);
  (self as unknown as Worker).postMessage(result, transfer);
};
