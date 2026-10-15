import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { ar, enUS, he } from "date-fns/locale";

const LOCALES = { ar, en: enUS, he } as const;

function useLang() {
  const { i18n } = useTranslation();
  return (i18n.language?.slice(0, 2) ?? "en") as keyof typeof LOCALES;
}

// "2 months ago" in the UI language. date-fns defaults to English, which in an RTL paragraph also
// gets its digits reordered ("months ago 2"), so every relative timestamp goes through here.
export function useTimeAgo() {
  const locale = LOCALES[useLang()] ?? enUS;
  return useCallback(
    (date: Date | string | number) =>
      formatDistanceToNow(new Date(date), { addSuffix: true, locale }),
    [locale],
  );
}

// Numbers grouped per the UI language but always in Latin digits. A bare toLocaleString() uses the
// runtime's locale — Node on the server, the browser on the client — so an Arabic browser rendered
// "٣٤٠" over the server's "340" and the page failed hydration.
export function useFormatNumber() {
  const lang = useLang();
  return useCallback((n: number) => n.toLocaleString(`${lang}-u-nu-latn`), [lang]);
}
