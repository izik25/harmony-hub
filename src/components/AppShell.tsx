import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { isRTL, setLanguage } from "@/lib/i18n";
import { BottomNav } from "./BottomNav";

export function AppShell({ children, hideNav = false }: { children: ReactNode; hideNav?: boolean }) {
  const { i18n } = useTranslation();

  useEffect(() => {
    const lng = i18n.language || "en";
    document.documentElement.lang = lng;
    document.documentElement.dir = isRTL(lng) ? "rtl" : "ltr";
    document.documentElement.classList.add("dark");
    // Initialize once from detector on first mount
    if (!localStorage.getItem("lang")) setLanguage(lng);
  }, [i18n.language]);

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-[520px] flex-col bg-background text-foreground">
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-70"
        style={{ background: "var(--gradient-glow)" }}
      />
      <main className={`relative flex-1 ${hideNav ? "" : "pb-20"}`}>{children}</main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
