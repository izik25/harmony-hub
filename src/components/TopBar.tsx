import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, Wallet, Radio, LogOut, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { setLanguage } from "@/lib/i18n";
import { logout } from "@/functions/auth";
import { unreadNotificationCount } from "@/functions/notifications";
import { unreadMessageCount } from "@/functions/messages";

export function TopBar({ transparent = false }: { transparent?: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: unreadCount } = useQuery({
    queryKey: ["unreadNotificationCount"],
    queryFn: () => unreadNotificationCount(),
    refetchInterval: 15_000,
  });
  const { data: unreadMessages } = useQuery({
    queryKey: ["unreadMessageCount"],
    queryFn: () => unreadMessageCount(),
    refetchInterval: 8_000,
  });
  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      queryClient.setQueryData(["currentUser"], null);
      navigate({ to: "/login" });
    },
  });
  const langs = [
    { code: "en", label: "EN" },
    { code: "he", label: "עב" },
    { code: "ar", label: "عر" },
  ];

  const iconBtn = transparent
    ? "rounded-full p-2 text-white drop-shadow-md hover:text-brand-gold"
    : "rounded-full p-2 text-foreground/80 hover:text-primary";

  return (
    <div
      className={`sticky top-0 z-30 flex items-center justify-between px-4 py-3 ${
        transparent
          ? "bg-gradient-to-b from-black/55 via-black/15 to-transparent"
          : "glass border-b border-border"
      }`}
    >
      <Link
        to="/"
        className={`font-display text-xl font-bold transition-transform duration-200 ease-out hover:-translate-y-0.5 ${
          transparent ? "text-white drop-shadow-md" : "text-brand-coral"
        }`}
      >
        SONA
      </Link>
      <div className="flex items-center gap-1">
        {langs.map((l) => (
          <button
            key={l.code}
            onClick={() => setLanguage(l.code)}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
              i18n.language?.startsWith(l.code)
                ? transparent
                  ? "bg-white/25 text-white"
                  : "bg-primary/20 text-primary"
                : transparent
                  ? "text-white/70 drop-shadow-md hover:text-white"
                  : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {l.label}
          </button>
        ))}
        <div className={`mx-1 h-5 w-px ${transparent ? "bg-white/30" : "bg-border"}`} />
        <Link to="/live" aria-label={t("nav.live")} className={iconBtn}>
          <Radio className="h-5 w-5" />
        </Link>
        <Link to="/wallet" aria-label={t("nav.wallet")} className={iconBtn}>
          <Wallet className="h-5 w-5" />
        </Link>
        <Link to="/messages" aria-label={t("nav.messages")} className={`relative ${iconBtn}`}>
          <Mail className="h-5 w-5" />
          {!!unreadMessages && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
          )}
        </Link>
        <Link
          to="/notifications"
          aria-label={t("nav.notifications")}
          className={`relative ${iconBtn}`}
        >
          <Bell className="h-5 w-5" />
          {!!unreadCount && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
          )}
        </Link>
        <button
          aria-label={t("nav.logout")}
          onClick={() => logoutMutation.mutate()}
          className={iconBtn}
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
