import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { put } from "@vercel/blob";
import { requireUserId } from "./auth";
import { toSafeError } from "./safe-error";

const ALLOWED_EXT = new Set([
  "mp3",
  "wav",
  "webm",
  "ogg",
  "m4a",
  "mp4",
  "mov",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
]);
const MAX_BYTES = 100 * 1024 * 1024;

/**
 * Serverless deployments (Vercel) have no writable, persistent local disk — uploads have to go
 * to real object storage there. Local dev has no Blob store configured, so it falls back to
 * writing straight into public/uploads/. Shared by uploadMedia (user-picked files) and any
 * server-generated media (e.g. AI cover images) that needs the same destination.
 */
export async function storeMediaBuffer(
  buffer: Buffer,
  filename: string,
  contentType?: string,
): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(filename, buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType,
    });
    return blob.url;
  }

  // Dynamic imports (not top-level ones) — this file's other export, uploadMedia, is a
  // createServerFn whose splitting only strips the wrapped handler body for the client bundle, not
  // this plain function's own top-level code. A static `import ... from "node:fs/promises"` (or
  // computing UPLOAD_DIR via a top-level `path.join(process.cwd(), ...)`) used to get bundled
  // straight into the client and throw the moment it was touched.
  const [{ mkdir, writeFile }, path] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), buffer);
  return `/uploads/${filename}`;
}

export const uploadMedia = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as FormData)
  .handler(async ({ data }) => {
    await requireUserId();
    const file = data.get("file");
    if (!(file instanceof File)) throw new Error("noFileProvided");
    if (file.size === 0) throw new Error("emptyFile");
    if (file.size > MAX_BYTES) throw new Error("fileTooLarge");

    const ext = (file.name.split(".").pop() || "webm").toLowerCase().replace(/[^a-z0-9]/g, "");
    const safeExt = ALLOWED_EXT.has(ext) ? ext : "webm";
    const filename = `${randomUUID()}.${safeExt}`;

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const url = await storeMediaBuffer(buffer, filename, file.type || undefined);
      return { url };
    } catch (error) {
      throw toSafeError(error);
    }
  });
