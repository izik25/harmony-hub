import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { guessFromAcceptLanguageHeader } from "@/lib/i18n";

const SUPPORTED = new Set(["en", "he", "ar"]);

/**
 * Resolves which language to render on the very first SSR pass, so a fresh
 * request already matches what the client will settle on — avoiding a
 * hydration mismatch / language flash. Prefers the "lang" cookie (mirrors a
 * manual in-app choice) over the Accept-Language header (mirrors the
 * browser's default), same precedence as the client-side detector.
 */
export const detectServerLanguage = createServerFn({ method: "GET" }).handler(async () => {
  const cookieLang = getCookie("lang");
  if (cookieLang && SUPPORTED.has(cookieLang)) return cookieLang;
  return guessFromAcceptLanguageHeader(getRequestHeader("accept-language"));
});
