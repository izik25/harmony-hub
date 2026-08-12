export type ShareResult = "shared" | "copied" | "cancelled";

// Tries the native share sheet first (works across apps on mobile), falls back to
// clipboard on desktop/unsupported browsers. Returns "cancelled" when the user backs
// out of the native sheet so callers can skip side effects like incrementing a counter.
export async function shareContent(payload: {
  title: string;
  url: string;
  text?: string;
}): Promise<ShareResult> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "cancelled";
      // Fall through to clipboard for any other failure (e.g. share target crashed).
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(payload.url);
    return "copied";
  }
  return "cancelled";
}
