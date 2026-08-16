/**
 * Explicitly routes playback to a connected headset instead of the phone's own speaker/earpiece.
 *
 * Requesting `echoCancellation: true` from getUserMedia (needed for the actual mic recording —
 * see MIC_CONSTRAINTS in record.tsx) puts Android's audio session into "voice communication"
 * mode. In that mode Android routes output through the handset earpiece/speaker by default,
 * silently overriding a connected wired or Bluetooth headset — normal media playback would have
 * gone to the headset correctly, but this WebRTC-triggered mode does not. Chrome for Android
 * exposes this routing as a fixed set of `audiooutput` device entries ("Wired Headset",
 * "Bluetooth", "Speakerphone", "Earpiece") specifically so a page can call `setSinkId()` and
 * explicitly send output back to the headset. Device labels only become non-empty once mic
 * permission has actually been granted, so this only works — and only needs to run — right after
 * a getUserMedia() call resolves, not before.
 *
 * No-ops quietly wherever this doesn't apply: setSinkId isn't supported at all on iOS Safari, and
 * on desktop there's usually no separate "voice mode" routing problem to begin with.
 */
export async function routeToHeadphonesIfAvailable(
  ...elements: Array<HTMLMediaElement | null | undefined>
): Promise<void> {
  const targets = elements.filter((el): el is HTMLMediaElement => !!el);
  if (targets.length === 0) return;
  if (typeof HTMLMediaElement === "undefined" || !("setSinkId" in HTMLMediaElement.prototype)) {
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const isHeadphoneLike = (label: string) =>
      /headset|headphone|bluetooth|earbud|airpods|wired/i.test(label);
    const isBuiltInRoute = (label: string) => /speakerphone|earpiece|receiver/i.test(label);
    const match = outputs.find((d) => isHeadphoneLike(d.label) && !isBuiltInRoute(d.label));
    if (!match) return;
    await Promise.all(targets.map((el) => el.setSinkId(match.deviceId).catch(() => {})));
  } catch {
    // Best-effort — recording still works fine even if output routing couldn't be fixed here.
  }
}
