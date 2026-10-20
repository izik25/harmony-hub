/**
 * Finds a connected headset among the browser's `audiooutput` devices — used only to *detect*
 * one (e.g. to warn that Bluetooth adds latency), never to route playback to it.
 *
 * This file used to also call setSinkId() to pin playback onto that device, back when the
 * recording mic requested `echoCancellation: true` and that put Android's audio session into
 * voice-communication ("call") mode, which sent output to the earpiece instead of the headset.
 * The device entries Chrome for Android lists here ("Wired headset", "Bluetooth",
 * "Speakerphone", "Earpiece") are exactly those call routes, though — selecting one keeps the
 * whole page in call mode, with the call path's extra buffering and voice processing (and
 * narrowband SCO for Bluetooth). With echoCancellation off (see MIC_CONSTRAINTS in record.tsx)
 * the default media route already lands on the headset, so the explicit routing only cost
 * latency and audio quality and was removed.
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
