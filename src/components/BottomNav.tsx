import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Search, Trophy, User, Plus } from "lucide-react";
// Non-`to` typed as string because Link is used with mixed routes.
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

export function BottomNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const items: Array<{ to: string; icon: typeof Home; label: string; center?: boolean }> = [
    { to: "/", icon: Home, label: t("nav.home") },
    { to: "/explore", icon: Search, label: t("nav.explore") },
    { to: "/record", icon: Plus, label: t("nav.record"), center: true },
    { to: "/competitions", icon: Trophy, label: t("nav.competitions") },
    { to: "/profile", icon: User, label: t("nav.profile") },
  ];

  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-[520px] -translate-x-1/2 glass border-t border-border/60">
      <ul className="grid grid-cols-5 items-end px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          if (it.center) {
            return (
              <li key={it.to} className="flex justify-center">
                <Link to={it.to as "/"} aria-label={it.label} className="group -mt-6 block">
                  <motion.div
                    whileTap={{ scale: 0.92 }}
                    className="grid h-14 w-14 place-items-center rounded-2xl gradient-neon glow-pink"
                  >
                    <Icon className="h-7 w-7 text-white" strokeWidth={2.5} />
                  </motion.div>
                </Link>
              </li>
            );
          }
          return (
            <li key={it.to} className="flex justify-center">
              <Link
                to={it.to as "/"}
                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                <span className="text-[10px] font-medium">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
