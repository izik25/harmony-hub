import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Home, Search, Trophy, User, Plus, Mic, Radio, Upload } from "lucide-react";
// Non-`to` typed as string because Link is used with mixed routes.
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function BottomNav({ overlay = false }: { overlay?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [createOpen, setCreateOpen] = useState(false);

  const items: Array<{ to: string; icon: typeof Home; label: string; center?: boolean }> = [
    { to: "/", icon: Home, label: t("nav.home") },
    { to: "/explore", icon: Search, label: t("nav.explore") },
    { to: "/record", icon: Plus, label: t("nav.record"), center: true },
    { to: "/competitions", icon: Trophy, label: t("nav.competitions") },
    { to: "/profile", icon: User, label: t("nav.profile") },
  ];

  const createOptions = [
    {
      icon: Mic,
      label: t("createMenu.record"),
      hint: t("createMenu.recordHint"),
      to: "/record" as const,
    },
    {
      icon: Radio,
      label: t("createMenu.goLive"),
      hint: t("createMenu.goLiveHint"),
      to: "/live" as const,
    },
    {
      icon: Upload,
      label: t("createMenu.upload"),
      hint: t("createMenu.uploadHint"),
      to: "/upload" as const,
    },
  ];

  return (
    <nav
      className={`fixed bottom-0 left-1/2 z-40 w-full max-w-[520px] -translate-x-1/2 ${
        overlay
          ? "bg-gradient-to-t from-black/85 via-black/40 to-transparent pt-6"
          : "bg-brand-indigo shadow-pop-lg"
      }`}
    >
      <ul className="grid grid-cols-5 items-end px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          if (it.center) {
            return (
              <li key={it.to} className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  aria-label={t("createMenu.title")}
                  className="group -mt-6 block"
                >
                  <motion.div
                    whileTap={{ scale: 0.88, rotate: -4 }}
                    whileHover={{ scale: 1.05, y: -2 }}
                    transition={{ type: "spring", stiffness: 420, damping: 22 }}
                    className={`grid h-14 w-14 place-items-center rounded-2xl bg-brand-coral shadow-pop-coral ring-4 ${
                      overlay ? "ring-black/40" : "ring-brand-indigo"
                    }`}
                  >
                    <Icon className="h-7 w-7 text-white" strokeWidth={2.5} />
                  </motion.div>
                </button>
              </li>
            );
          }
          return (
            <li key={it.to} className="flex justify-center">
              <Link
                to={it.to as "/"}
                className={`relative flex flex-col items-center gap-1 px-2 py-1 transition-all duration-200 ease-out ${
                  active
                    ? "-translate-y-0.5 text-brand-gold"
                    : overlay
                      ? "text-white/70 hover:text-white"
                      : "text-white/60 hover:text-white"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                <span className="text-[10px] font-medium">{it.label}</span>
                {active && (
                  <motion.span
                    layoutId="bottomnav-active-dot"
                    className="absolute -top-1.5 h-1 w-1 rounded-full bg-brand-gold"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>{t("createMenu.title")}</SheetTitle>
          </SheetHeader>
          <div className="mt-2 space-y-1">
            {createOptions.map((opt) => (
              <button
                key={opt.to}
                onClick={() => {
                  setCreateOpen(false);
                  navigate({ to: opt.to });
                }}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start press-scale hover:bg-muted"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-coral/10 text-brand-coral">
                  <opt.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
