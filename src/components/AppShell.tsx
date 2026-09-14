import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { isRTL, setLanguage } from "@/lib/i18n";
import { BottomNav } from "./BottomNav";

export function AppShell({
  children,
  hideNav = false,
  overlayNav = false,
}: {
  children: ReactNode;
  hideNav?: boolean;
  /** Nav floats over the content instead of reserving space below it — for a full-bleed screen like the feed. */
  overlayNav?: boolean;
}) {
  const { i18n } = useTranslation();

  useEffect(() => {
    const lng = i18n.language || "en";
    document.documentElement.lang = lng;
    document.documentElement.dir = isRTL(lng) ? "rtl" : "ltr";
    // Initialize once from detector on first mount
    if (!localStorage.getItem("lang")) setLanguage(lng);
  }, [i18n.language]);

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-[520px] flex-col bg-background text-foreground">
      <main className={`relative flex-1 ${hideNav || overlayNav ? "" : "pb-20"}`}>{children}</main>
      {!hideNav && <BottomNav overlay={overlayNav} />}
    </div>
  );
}
