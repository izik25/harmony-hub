import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  Home,
  Languages,
  LogOut,
  Mail,
  Mic,
  Plus,
  Radio,
  Search,
  Trophy,
  Upload,
  User,
  Wallet,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLanguage } from "@/lib/i18n";
import { logout } from "@/functions/auth";
import { unreadNotificationCount } from "@/functions/notifications";
import { unreadMessageCount } from "@/functions/messages";

const LANGS = [
  { code: "en", name: "English" },
  { code: "he", name: "עברית" },
  { code: "ar", name: "العربية" },
];

// Desktop (lg+) navigation rail. Replaces both the TopBar and the BottomNav at that width, the way
// TikTok/Instagram web do, so wide screens get a real layout instead of a phone in the middle.
// Shares query keys with TopBar so the unread badges come from the same cache.
export function SideNav() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
  const currentLang = LANGS.find((l) => i18n.language?.startsWith(l.code))?.code ?? "en";

  const items = [
    { to: "/", icon: Home, label: t("nav.home") },
    { to: "/explore", icon: Search, label: t("nav.explore") },
    { to: "/competitions", icon: Trophy, label: t("nav.competitions") },
    { to: "/live", icon: Radio, label: t("nav.live") },
    { to: "/messages", icon: Mail, label: t("nav.messages"), dot: !!unreadMessages },
    { to: "/notifications", icon: Bell, label: t("nav.notifications"), dot: !!unreadCount },
    { to: "/wallet", icon: Wallet, label: t("nav.wallet") },
    { to: "/profile", icon: User, label: t("nav.profile") },
  ];
  const isActive = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-border px-3 py-5 lg:flex">
      <Link to="/" className="mb-6 px-3">
        <img
          src="/brand/logo-wordmark-alpha.png"
          alt="Studio26"
          width={701}
          height={216}
          className="h-10 w-auto"
        />
      </Link>

      <nav className="flex flex-col gap-0.5">
        {items.map((it) => {
          const active = isActive(it.to);
          return (
            <Link
              key={it.to}
              to={it.to as "/"}
              className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors ${
                active
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <span className="relative">
                <it.icon
                  className={`h-5 w-5 ${active ? "text-brand-gold" : ""}`}
                  strokeWidth={active ? 2.5 : 2}
                />
                {it.dot && (
                  <span className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                )}
              </span>
              {it.label}
            </Link>
          );
        })}
      </nav>

      <DropdownMenu>
        <DropdownMenuTrigger className="mt-5 flex items-center justify-center gap-2 rounded-full bg-brand-coral py-3 text-sm font-bold text-white shadow-pop-coral press-scale">
          <Plus className="h-5 w-5" strokeWidth={2.5} />
          {t("createMenu.title")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60 rounded-2xl p-1.5">
          {[
            {
              to: "/record",
              icon: Mic,
              label: t("createMenu.record"),
              hint: t("createMenu.recordHint"),
            },
            {
              to: "/live",
              icon: Radio,
              label: t("createMenu.goLive"),
              hint: t("createMenu.goLiveHint"),
            },
            {
              to: "/upload",
              icon: Upload,
              label: t("createMenu.upload"),
              hint: t("createMenu.uploadHint"),
            },
          ].map((opt) => (
            <DropdownMenuItem key={opt.to} asChild className="rounded-xl py-2.5">
              <Link to={opt.to as "/"}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-coral/15 text-brand-coral">
                  <opt.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground">
            <Languages className="h-5 w-5" />
            {LANGS.find((l) => l.code === currentLang)?.name}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44 rounded-2xl p-1.5">
            <DropdownMenuRadioGroup value={currentLang} onValueChange={setLanguage}>
              {LANGS.map((l) => (
                <DropdownMenuRadioItem key={l.code} value={l.code} className="rounded-xl py-2">
                  {l.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={() => logoutMutation.mutate()}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/60 hover:text-brand-coral"
        >
          <LogOut className="h-5 w-5" />
          {t("nav.logout")}
        </button>
      </div>
    </aside>
  );
}
