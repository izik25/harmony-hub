/**
 * Finds a connected headset among the browser's `audiooutput` devices. record.tsx's live monitor
 * passes it as its AudioContext's `sinkId` (pinning the monitor to the headset measured lower
 * latency on real phones than leaving it on the default route), and also uses it to warn that
 * Bluetooth adds latency.
 *
 * Device labels only become non-empty once mic permission has actually been granted, so call
 * this after a getUserMedia() call resolves.
 */
export async function findHeadphoneOutput(): Promise<MediaDeviceInfo | undefined> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const isHeadphoneLike = (label: string) =>
      /headset|headphone|bluetooth|earbud|airpods|wired/i.test(label);
    const isBuiltInRoute = (label: string) => /speakerphone|earpiece|receiver/i.test(label);
    return outputs.find((d) => isHeadphoneLike(d.label) && !isBuiltInRoute(d.label));
  } catch {
    // Best-effort — the monitor just stays on the default route without it.
    return undefined;
  }
}
