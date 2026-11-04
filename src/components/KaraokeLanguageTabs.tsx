import { useTranslation } from "react-i18next";
import { LANGUAGES } from "@/lib/i18n";

/** A row of language tabs, each named in its own script. Hidden when there's only one language. */
export function KaraokeLanguageTabs({
  languages,
  value,
  onChange,
}: {
  languages: ReadonlyArray<string>;
  value: string | undefined;
  onChange: (code: string) => void;
}) {
  const { t } = useTranslation();
  if (languages.length < 2) return null;

  return (
    <div
      role="group"
      aria-label={t("nav.language")}
      className="no-scrollbar -mx-1 mt-3 flex items-center gap-2 overflow-x-auto px-1"
    >
      {languages.map((code) => {
        const lang = LANGUAGES.find((l) => l.code === code);
        const selected = code === value;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={selected}
            onClick={() => onChange(code)}
            className={`press-scale shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-200 ease-out ${
              selected
                ? "bg-brand-coral text-white shadow-pop-coral"
                : "border border-border bg-card text-muted-foreground"
            }`}
          >
            {lang?.name ?? code}
          </button>
        );
      })}
    </div>
  );
}
