import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireUserId } from "./auth";
import { storeMediaBuffer } from "./uploads";
import { toSafeError } from "./safe-error";

function buildPrompt(songTitle: string, category?: string) {
  const genre = category?.trim() ? ` in the style of ${category.trim()} music` : "";
  return (
    `Album cover artwork${genre} for a song called "${songTitle}". ` +
    "Bold, striking, modern digital art, evocative of the song's title and mood, " +
    "no text, no letters, no watermark, square composition."
  );
}

export const generateCoverImage = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { songTitle: string; category?: string })
  .handler(async ({ data }) => {
    await requireUserId();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("imageGenNotConfigured");

    const songTitle = data.songTitle.trim() || "an untitled karaoke performance";
    const prompt = buildPrompt(songTitle, data.category);

    try {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt,
          size: "1024x1024",
          n: 1,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("OpenAI image generation failed", res.status, body);
        if (
          res.status === 429 ||
          body.includes("insufficient_quota") ||
          body.includes("credit_balance_exhausted")
        ) {
          throw new Error("imageGenNoCredits");
        }
        throw new Error("imageGenFailed");
      }

      const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new Error("imageGenFailed");

      const buffer = Buffer.from(b64, "base64");
      const url = await storeMediaBuffer(buffer, `cover-${randomUUID()}.png`, "image/png");
      return { url };
    } catch (error) {
      throw toSafeError(error);
    }
  });
