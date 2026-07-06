import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Heart, UserPlus, Gift, MessageCircle, Trophy } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { notifications } from "@/lib/mock-data";

export const Route = createFileRoute("/notifications")({
  component: NotifPage,
});

const iconMap = {
  like: <Heart className="h-4 w-4 text-primary" />,
  follow: <UserPlus className="h-4 w-4 text-accent" />,
  gift: <Gift className="h-4 w-4 text-accent" />,
  comment: <MessageCircle className="h-4 w-4 text-foreground" />,
  invited: <Trophy className="h-4 w-4 text-primary" />,
} as const;

function NotifPage() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <h1 className="font-display text-2xl font-bold">{t("notif.title")}</h1>
        <ul className="mt-4 divide-y divide-border">
          {notifications.map((n) => (
            <li key={n.id} className="flex items-center gap-3 py-3">
              <div className="relative">
                <img src={n.avatar} className="h-11 w-11 rounded-full" />
                <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-card ring-2 ring-background">
                  {iconMap[n.type as keyof typeof iconMap]}
                </span>
              </div>
              <div className="flex-1">
                <p className="text-sm">
                  <span className="font-semibold">{n.user}</span>{" "}
                  <span className="text-muted-foreground">{t(`notif.${n.type === "invited" ? "invited" : n.type + "d"}`)}</span>{" "}
                  {n.extra && <span className="text-accent">{n.extra}</span>}
                </p>
                <p className="text-[11px] text-muted-foreground">{n.time}</p>
              </div>
              {n.type === "follow" && (
                <button className="rounded-full gradient-neon px-3 py-1 text-xs font-bold text-white">
                  {t("common.follow")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
