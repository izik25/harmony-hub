import { Link } from "@tanstack/react-router";
import { Bell, Wallet, Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { setLanguage } from "@/lib/i18n";

export function TopBar({ transparent = false }: { transparent?: boolean }) {
  const { i18n } = useTranslation();
  const langs = [
    { code: "en", label: "EN" },
    { code: "he", label: "עב" },
    { code: "ar", label: "عر" },
  ];

  return (
    <div
      className={`sticky top-0 z-30 flex items-center justify-between px-4 py-3 ${
        transparent ? "" : "glass border-b border-border/60"
      }`}
    >
      <Link to="/" className="font-display text-xl font-bold gradient-neon-text">
        SONA
      </Link>
      <div className="flex items-center gap-1">
        {langs.map((l) => (
          <button
            key={l.code}
            onClick={() => setLanguage(l.code)}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
              i18n.language?.startsWith(l.code)
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {l.label}
          </button>
        ))}
        <div className="mx-1 h-5 w-px bg-border" />
        <Link to="/live" aria-label="Live" className="rounded-full p-2 text-foreground/80 hover:text-primary">
          <Radio className="h-5 w-5" />
        </Link>
        <Link to="/wallet" aria-label="Wallet" className="rounded-full p-2 text-foreground/80 hover:text-primary">
          <Wallet className="h-5 w-5" />
        </Link>
        <Link to="/notifications" aria-label="Notifications" className="relative rounded-full p-2 text-foreground/80 hover:text-primary">
          <Bell className="h-5 w-5" />
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
        </Link>
      </div>
    </div>
  );
}
