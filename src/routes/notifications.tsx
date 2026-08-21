import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Heart,
  UserPlus,
  Gift,
  MessageCircle,
  Trophy,
  ThumbsUp,
  Mail,
  Briefcase,
} from "lucide-react";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { listNotifications, markAllNotificationsRead } from "@/functions/notifications";
import { toggleFollow } from "@/functions/posts";

export const Route = createFileRoute("/notifications")({
  component: NotifPage,
});

const iconMap: Record<string, React.ReactNode> = {
  like: <Heart className="h-4 w-4 text-brand-coral" />,
  follow: <UserPlus className="h-4 w-4 text-brand-indigo" />,
  gift: <Gift className="h-4 w-4 text-brand-gold" />,
  comment: <MessageCircle className="h-4 w-4 text-brand-teal" />,
  invited: <Trophy className="h-4 w-4 text-brand-gold" />,
  vote: <ThumbsUp className="h-4 w-4 text-brand-indigo" />,
  contact_request: <Mail className="h-4 w-4 text-brand-teal" />,
  audition_application: <Briefcase className="h-4 w-4 text-brand-coral" />,
};

const staggerClasses = ["stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6"];

const textKeyMap: Record<string, string> = {
  like: "liked",
  follow: "followed",
  gift: "gifted",
  comment: "commented",
  invited: "invited",
  vote: "voted",
  contact_request: "contact_requested",
  audition_application: "audition_application",
};

function NotifPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
  });

  const markReadMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["unreadNotificationCount"] }),
  });

  useEffect(() => {
    markReadMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const followMutation = useMutation({
    mutationFn: (userId: string) => toggleFollow({ data: { userId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feed"] }),
  });

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <h1 className="font-display text-2xl font-bold">{t("notif.title")}</h1>
        {notifications?.length === 0 && (
          <p className="mt-6 text-center text-sm text-muted-foreground">{t("notif.empty")}</p>
        )}
        <ul className="mt-4 divide-y divide-border">
          {notifications?.map((n, i) => (
            <li
              key={n.id}
              className={`flex items-center gap-3 py-3 animate-fade-up ${staggerClasses[i % 6]}`}
            >
              <div className="relative">
                <img src={n.actor.avatarUrl} className="h-11 w-11 rounded-full" alt="" />
                <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-card ring-2 ring-background">
                  {iconMap[n.type] ?? <Heart className="h-4 w-4" />}
                </span>
              </div>
              <div className="flex-1">
                <p className="text-sm">
                  <span className="font-semibold">{n.actor.name}</span>{" "}
                  <span className="text-muted-foreground">
                    {t(`notif.${textKeyMap[n.type] ?? n.type}`)}
                  </span>{" "}
                  {n.type === "gift" && n.extra.giftEmoji && (
                    <span className="text-accent">{String(n.extra.giftEmoji)}</span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </p>
              </div>
              {n.type === "follow" && (
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => followMutation.mutate(n.actor.id)}
                  disabled={followMutation.isPending}
                  className="rounded-full bg-brand-coral px-3 py-1 text-xs font-bold text-white shadow-pop-coral disabled:opacity-60"
                >
                  {t("common.follow")}
                </motion.button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
