import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGS, currentLangCode } from "@/lib/i18n";

/**
 * Which playback language the karaoke picker shows. Opens on the viewer's UI language when there
 * are playbacks in it, otherwise on the language with the most singers, so the grid is never
 * empty while other languages have songs. A tap on a tab overrides that for the session.
 */
export function useKaraokeLanguage(items: ReadonlyArray<{ language: string }> | undefined) {
  const { i18n } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items ?? []) map.set(item.language, (map.get(item.language) ?? 0) + 1);
    return map;
  }, [items]);

  // Menu order (as in the language picker) rather than by count, so the tabs don't reshuffle as
  // songs are added.
  const available = useMemo(() => SUPPORTED_LANGS.filter((code) => counts.has(code)), [counts]);

  const uiLang = currentLangCode(i18n.language);
  const fallback = available.includes(uiLang)
    ? uiLang
    : available.reduce<string | undefined>(
        (best, code) => (best && counts.get(best)! >= counts.get(code)! ? best : code),
        undefined,
      );

  const active = picked && available.includes(picked) ? picked : fallback;
  return { available, active, setActive: setPicked };
}
