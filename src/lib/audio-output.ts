/**
 * Finds a connected headset among the browser's `audiooutput` devices — used only to *detect*
 * one (to warn that Bluetooth adds latency), never to route playback to it. The device entries
 * Chrome for Android lists here ("Wired headset", "Bluetooth", "Speakerphone", "Earpiece") are its
 * call routes: pinning output to one with setSinkId puts playback on the phone-call path (call
 * volume, voice processing, narrowband SCO on Bluetooth) and, tried twice for the live monitor,
 * never made it any faster. The default media route already lands on the headphones.
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
    // Best-effort — only feeds an informational hint.
    return undefined;
  }
}
