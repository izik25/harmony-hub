import { upload } from "@vercel/blob/client";
import { uploadMedia } from "@/functions/uploads";

const MAX_FALLBACK_ATTEMPTS = 3;

// A server function's own rejections (file too large, not signed in, ...) cross the RPC boundary
// as plain, serialized Error objects — they never arrive on the client as a real TypeError. A
// TypeError reaching uploadViaServerFn below can therefore only be the browser's own fetch-level
// failure (dropped connection, flaky Wi-Fi mid-upload, offline), which is exactly the transient
// case worth retrying rather than a rejection that would just fail identically again.
function isTransientNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

// This fallback is the one path most exposed to a flaky connection: it's what runs whenever
// there's no BLOB_READ_WRITE_TOKEN for the direct-to-Blob path (every local dev server, including
// one reached over LAN Wi-Fi from a phone for real-camera testing), carrying the recording's full
// bytes itself rather than a signed-URL handshake. A several-MB camera take over spotty Wi-Fi was
// surfacing as an unhandled "Failed to fetch" that aborted the whole save with nothing recoverable
// — a plain retry-with-backoff is exactly what a transient drop needs.
async function uploadViaServerFn(file: File | Blob, filename: string): Promise<{ url: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
    try {
      const formData = new FormData();
      formData.append("file", file, filename);
      return await uploadMedia({ data: formData });
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err) || attempt === MAX_FALLBACK_ATTEMPTS - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Uploads a recording/export/media file, preferring a direct browser-to-Blob upload so the file
 * body never has to pass through our serverless function (which is capped well under the size of
 * a typical WAV recording — see server.ts's /api/blob-upload for the full story). Falls back to
 * the original small-file-safe server-function upload when direct upload isn't available, which
 * is exactly what happens in local dev (no BLOB_READ_WRITE_TOKEN configured) — the endpoint
 * responds with an error and this catches it, no branching needed at call sites.
 */
export async function smartUploadMedia(
  file: File | Blob,
  filename: string,
): Promise<{ url: string }> {
  try {
    const blob = await upload(filename, file, {
      access: "public",
      handleUploadUrl: "/api/blob-upload",
    });
    return { url: blob.url };
  } catch {
    return uploadViaServerFn(file, filename);
  }
}
