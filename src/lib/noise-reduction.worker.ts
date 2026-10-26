import { reduceNoise } from "./noise-reduction";

// Worker side of reduceNoiseOffThread: one take in, the noise-reduced take back (transferred,
// not copied — a few minutes of audio is tens of megabytes).
self.onmessage = (e: MessageEvent<Float32Array>) => {
  const result = reduceNoise(e.data);
  (self as unknown as Worker).postMessage(result, [result.buffer]);
};
