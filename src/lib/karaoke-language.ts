import { SUPPORTED_LANGS } from "./i18n";

// Scripts that give a language away. Kana is checked before Han because Japanese titles mix kanji
// with kana, while a Han-only name is far more likely Chinese. Latin script is shared by too many
// languages to guess from, so it has no entry here: Latin-script songs need a language folder.
const SCRIPT_LANGS: Array<[RegExp, string]> = [
  [/[֐-׿]/, "he"],
  [/[؀-ۿ]/, "ar"],
  [/[Ѐ-ӿ]/, "ru"],
  [/[぀-ヿ]/, "ja"],
  [/[가-힯ᄀ-ᇿ]/, "ko"],
  [/[一-鿿]/, "zh"],
  [/[ऀ-ॿ]/, "hi"],
];

/** The language a name's alphabet implies ("אייל גולן" → "he"), or null for Latin script. */
export function languageFromScript(text: string): string | null {
  for (const [pattern, lang] of SCRIPT_LANGS) if (pattern.test(text)) return lang;
  return null;
}

/** True for a folder name under public/karaoke that marks a playback language ("es", "ja"…). */
export function isKaraokeLanguage(code: string): boolean {
  return SUPPORTED_LANGS.includes(code);
}
