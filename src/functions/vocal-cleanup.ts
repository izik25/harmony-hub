import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { requireUserId } from "./auth";
import { storeMediaBuffer } from "./uploads";
import { toSafeError } from "./safe-error";

/**
 * AI Vocal Cleanup — runs a draft's raw take through the vocal-isolation + de-reverb model
 * (ml/vocal-cleanup, deployed to Replicate) and stores the dry result as cleanVocalUrl, which
 * Studio then uses in place of the raw take. This is the part browser DSP can't do: room
 * reflections and backing-track bleed share the voice's frequencies and timing, so only a model
 * trained to tell them apart can take them out.
 *
 * Async by design: a GPU job (plus a possible cold boot) can run well past a serverless request's
 * time limit, so start returns right away with a prediction id, and Studio polls status, which
 * collects the result once Replicate reports it done. The output is copied into our own storage
 * immediately — Replicate deletes prediction files after an hour.
 */

const REPLICATE_API = "https://api.replicate.com/v1";

type Prediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[] | null;
  error?: string | null;
};

function replicateConfig() {
  const token = process.env.REPLICATE_API_TOKEN;
  // The 64-char version id `cog push` prints — community models can only be run by version.
  const version = process.env.REPLICATE_VOCAL_CLEANUP_VERSION;
  if (!token || !version) throw new Error("vocalCleanupNotConfigured");
  return { token, version };
}

async function replicateFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${REPLICATE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Replicate request failed", path, res.status, body);
    if (res.status === 402 || body.includes("billing")) throw new Error("vocalCleanupNoCredits");
    throw new Error("vocalCleanupFailed");
  }
  return res.json();
}

/**
 * Replicate fetches inputs by URL, which works as-is for Vercel Blob (public https). Local dev
 * stores uploads under /public/uploads with a relative URL Replicate can't reach, so those get
 * pushed through Replicate's own file upload first.
 */
async function publicInputUrl(token: string, url: string): Promise<string> {
  if (/^https:\/\//i.test(url)) return url;
  const [{ readFile }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const local = path.join(
    process.cwd(),
    "public",
    decodeURIComponent(new URL(url, "http://x").pathname),
  );
  const form = new FormData();
  form.append("content", new Blob([await readFile(local)]), path.basename(local));
  const file = (await replicateFetch(token, "/files", { method: "POST", body: form })) as {
    urls: { get: string };
  };
  return file.urls.get;
}

async function ownedDraft(id: string) {
  const userId = await requireUserId();
  const [draft] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, userId)));
  if (!draft) throw new Error("draftNotFound");
  return draft;
}

export const startVocalCleanup = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { draftId: string })
  .handler(async ({ data }) => {
    try {
      const draft = await ownedDraft(data.draftId);
      if (!draft.rawVocalUrl) throw new Error("vocalCleanupNoRawTake");
      if (draft.cleanVocalUrl) return { status: "succeeded" as const };
      if (draft.vocalCleanupJob) return { status: "processing" as const };

      const { token, version } = replicateConfig();
      const prediction = (await replicateFetch(token, "/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          input: {
            audio: await publicInputUrl(token, draft.rawVocalUrl),
            reverb_removal: "normal",
            isolate_vocals: true,
          },
        }),
      })) as Prediction;

      await db.update(posts).set({ vocalCleanupJob: prediction.id }).where(eq(posts.id, draft.id));
      return { status: "processing" as const };
    } catch (error) {
      throw toSafeError(error);
    }
  });

export const getVocalCleanupStatus = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { draftId: string })
  .handler(async ({ data }) => {
    try {
      const draft = await ownedDraft(data.draftId);
      if (draft.cleanVocalUrl) {
        return { status: "succeeded" as const, cleanVocalUrl: draft.cleanVocalUrl };
      }
      if (!draft.vocalCleanupJob) return { status: "idle" as const };

      const { token } = replicateConfig();
      const job = draft.vocalCleanupJob;
      const prediction = (await replicateFetch(token, `/predictions/${job}`)) as Prediction;

      if (prediction.status === "failed" || prediction.status === "canceled") {
        console.error("Vocal cleanup prediction failed", job, prediction.error);
        await db.update(posts).set({ vocalCleanupJob: "" }).where(eq(posts.id, draft.id));
        return { status: "failed" as const };
      }
      if (prediction.status !== "succeeded") return { status: "processing" as const };

      const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      if (!outputUrl) throw new Error("vocalCleanupFailed");
      const res = await fetch(outputUrl);
      if (!res.ok) throw new Error("vocalCleanupFailed");
      const buffer = Buffer.from(await res.arrayBuffer());
      const cleanVocalUrl = await storeMediaBuffer(
        buffer,
        `clean-vocal-${randomUUID()}.flac`,
        "audio/flac",
      );

      // Only lands if this is still the job for the current take — a Fix a Section save in the
      // meantime clears vocalCleanupJob, and this result would no longer match the raw take.
      const landed = await db
        .update(posts)
        .set({ cleanVocalUrl, vocalCleanupJob: "" })
        .where(and(eq(posts.id, draft.id), eq(posts.vocalCleanupJob, job)))
        .returning({ id: posts.id });
      if (landed.length > 0) return { status: "succeeded" as const, cleanVocalUrl };
      // Either an overlapping poll already stored it (fine — report that one) or the take changed.
      const current = await ownedDraft(data.draftId);
      return current.cleanVocalUrl
        ? { status: "succeeded" as const, cleanVocalUrl: current.cleanVocalUrl }
        : { status: "idle" as const };
    } catch (error) {
      throw toSafeError(error);
    }
  });
