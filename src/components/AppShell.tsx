import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { isRTL, setLanguage } from "@/lib/i18n";
import { BottomNav } from "./BottomNav";
import { SideNav } from "./SideNav";

// Content column width from tablet up (md+); phones always get the 520px column.
const DESKTOP_WIDTH = {
  feed: "md:max-w-none lg:max-w-[520px]",
  default: "md:max-w-2xl",
  wide: "md:max-w-5xl",
} as const;

export function AppShell({
  children,
  hideNav = false,
  overlayNav = false,
  width = "default",
}: {
  children: ReactNode;
  hideNav?: boolean;
  /** Nav floats over the content instead of reserving space below it — for a full-bleed screen like the feed. */
  overlayNav?: boolean;
  /** How wide the content column may grow on desktop — "wide" for grid-heavy screens. */
  width?: keyof typeof DESKTOP_WIDTH;
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
    <div className="flex min-h-screen bg-background text-foreground">
      {!hideNav && <SideNav />}
      <div
        className={`relative mx-auto flex min-h-screen w-full min-w-0 max-w-[520px] flex-col ${
          hideNav ? "" : DESKTOP_WIDTH[width]
        }`}
      >
        <main className={`relative flex-1 ${hideNav || overlayNav ? "" : "pb-20 lg:pb-8"}`}>
          {children}
        </main>
        {!hideNav && <BottomNav overlay={overlayNav} />}
      </div>
    </div>
  );
}
