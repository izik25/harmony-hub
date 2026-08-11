import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createServerFn } from "@tanstack/react-start";
import { put } from "@vercel/blob";
import { requireUserId } from "./auth";
import { toSafeError } from "./safe-error";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
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
      // Serverless deployments (Vercel) have no writable, persistent local disk — uploads have
      // to go to real object storage there. Local dev has no Blob store configured, so it falls
      // back to writing straight into public/uploads/, same as before.
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const blob = await put(filename, file, { access: "public", addRandomSuffix: false });
        return { url: blob.url };
      }

      await mkdir(UPLOAD_DIR, { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(UPLOAD_DIR, filename), buffer);
      return { url: `/uploads/${filename}` };
    } catch (error) {
      throw toSafeError(error);
    }
  });
