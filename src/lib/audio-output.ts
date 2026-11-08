/**
 * Finds connected headphones among the browser's audio devices — used only to *detect* them (to
 * turn the live monitor on, and to warn that Bluetooth adds latency), never to route playback to
 * them. Both inputs and outputs are checked: Chrome for Android names its routes ("Wired headset",
 * "USB audio", "Bluetooth headset", "Speakerphone", "Headset earpiece") mostly on the *input*
 * side, often with nothing but a "default" entry among the outputs, while desktop browsers name
 * the headphones themselves among the outputs. USB-C headphones — what most phones without a jack
 * use for wired — only ever show up as "USB audio".
 *
 * Pinning output to one of Android's routes with setSinkId puts playback on the phone-call path
 * (call volume, voice processing, narrowband SCO on Bluetooth) and, tried twice for the live
 * monitor, never made it any faster. The default media route already lands on the headphones.
 *
 * Device labels only become non-empty once mic permission has actually been granted, so call
 * this after a getUserMedia() call resolves.
 */
export async function findHeadphones(): Promise<MediaDeviceInfo | undefined> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    // "USB audio" only as Android's exact route name — on a desktop, a plain USB microphone
    // ("USB Audio Device") says nothing about headphones, and treating it as one would switch the
    // monitor on through the speakers.
    const isHeadphoneLike = (label: string) =>
      /headset|headphone|bluetooth|earbud|airpods|wired|^usb audio$/i.test(label);
    const isBuiltInRoute = (label: string) => /speakerphone|earpiece|receiver/i.test(label);
    const audio = devices.filter((d) => d.kind === "audiooutput" || d.kind === "audioinput");
    const found = audio.filter((d) => isHeadphoneLike(d.label) && !isBuiltInRoute(d.label));
    // Wired first: plugging a cable in takes the media route over from a Bluetooth headset that
    // stays paired, so with both listed it's the wired pair actually playing.
    return found.find((d) => !/bluetooth/i.test(d.label)) ?? found[0];
  } catch {
    // Best-effort — only feeds a default and an informational hint.
    return undefined;
  }
}
