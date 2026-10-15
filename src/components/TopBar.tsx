import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, Wallet, Radio, LogOut, Mail, Menu, Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  // Each language is named in its own script, so a user stuck in the wrong one can still find theirs.
  const langs = [
    { code: "en", name: "English" },
    { code: "he", name: "עברית" },
    { code: "ar", name: "العربية" },
  ];

  // 44px hit area (Apple HIG minimum). The bar keeps only the high-frequency destinations inline —
  // everything else lives in the "more" menu so the row fits a 360px phone without overflowing.
  const iconBtn = `grid h-11 w-11 place-items-center rounded-full transition-colors ${
    transparent
      ? "text-white drop-shadow-md hover:text-brand-gold"
      : "text-foreground/80 hover:bg-muted hover:text-brand-coral"
  }`;
  const currentLang = langs.find((l) => i18n.language?.startsWith(l.code))?.code ?? "en";

  return (
    <div
      className={`sticky top-0 z-30 flex h-14 items-center justify-between gap-2 ps-4 pe-2 ${
        transparent
          ? "bg-gradient-to-b from-black/55 via-black/15 to-transparent"
          : "glass border-b border-border"
      }`}
    >
      <Link
        to="/"
        className="flex min-w-0 items-center gap-2 transition-transform duration-200 ease-out hover:-translate-y-0.5"
      >
        <img
          src="/brand/logo-wordmark-alpha.png"
          alt="Studio26"
          width={699}
          height={213}
          className={`h-8 w-auto ${transparent ? "drop-shadow-md" : ""}`}
        />
      </Link>
      <div className="flex shrink-0 items-center">
        <Link to="/messages" aria-label={t("nav.messages")} className={`relative ${iconBtn}`}>
          <Mail className="h-5 w-5" />
          {!!unreadMessages && (
            <span className="absolute end-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
          )}
        </Link>
        <Link
          to="/notifications"
          aria-label={t("nav.notifications")}
          className={`relative ${iconBtn}`}
        >
          <Bell className="h-5 w-5" />
          {!!unreadCount && (
            <span className="absolute end-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
          )}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={t("nav.more")} className={iconBtn}>
            <Menu className="h-5 w-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-2xl p-1.5">
            <DropdownMenuItem asChild className="rounded-xl py-2.5">
              <Link to="/wallet">
                <Wallet className="h-4 w-4" />
                {t("nav.wallet")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="rounded-xl py-2.5">
              <Link to="/live">
                <Radio className="h-4 w-4" />
                {t("nav.live")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Languages className="h-3.5 w-3.5" />
              {t("nav.language")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={currentLang} onValueChange={setLanguage}>
              {langs.map((l) => (
                <DropdownMenuRadioItem key={l.code} value={l.code} className="rounded-xl py-2">
                  {l.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => logoutMutation.mutate()}
              className="rounded-xl py-2.5 text-brand-coral focus:text-brand-coral"
            >
              <LogOut className="h-4 w-4" />
              {t("nav.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
