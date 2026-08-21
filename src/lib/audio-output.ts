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
  const match = await findHeadphoneOutput();
  if (!match) return;
  await Promise.all(targets.map((el) => el.setSinkId(match.deviceId).catch(() => {})));
}

/**
 * Same fix as routeToHeadphonesIfAvailable, but for an AudioContext's own output instead of an
 * <audio> element — see useMicLevels' monitor graph in record.tsx, which renders straight to
 * ctx.destination (skipping HTMLMediaElement's higher-latency playback pipeline) and so needs its
 * own sink routing. AudioContext.setSinkId is a newer, Chromium-only addition to the same Audio
 * Output Devices API HTMLMediaElement has had for longer, so this no-ops just as quietly wherever
 * it isn't supported.
 */
// Returns whether the routed-to device is Bluetooth, so callers can warn about the ~100-300ms of
// codec/radio buffering A2DP adds — a hardware/protocol delay no amount of AudioContext tuning on
// the page can shorten, since it happens downstream of everything the Web Audio API controls.
export async function routeAudioContextToHeadphonesIfAvailable(
  ctx: AudioContext | null | undefined,
): Promise<{ isBluetooth: boolean } | undefined> {
  if (!ctx || !("setSinkId" in ctx)) return undefined;
  const match = await findHeadphoneOutput();
  if (!match) return undefined;
  await (ctx as AudioContext & { setSinkId: (id: string) => Promise<void> })
    .setSinkId(match.deviceId)
    .catch(() => {});
  return { isBluetooth: /bluetooth/i.test(match.label) };
}

async function findHeadphoneOutput(): Promise<MediaDeviceInfo | undefined> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const isHeadphoneLike = (label: string) =>
      /headset|headphone|bluetooth|earbud|airpods|wired/i.test(label);
    const isBuiltInRoute = (label: string) => /speakerphone|earpiece|receiver/i.test(label);
    return outputs.find((d) => isHeadphoneLike(d.label) && !isBuiltInRoute(d.label));
  } catch {
    // Best-effort — recording still works fine even if output routing couldn't be fixed here.
    return undefined;
  }
}
