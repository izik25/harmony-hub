import { upload } from "@vercel/blob/client";
import { uploadMedia } from "@/functions/uploads";

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
    const formData = new FormData();
    formData.append("file", file, filename);
    return uploadMedia({ data: formData });
  }
}
