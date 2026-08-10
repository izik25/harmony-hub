import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { listConversations } from "@/functions/messages";

export const Route = createFileRoute("/messages")({
  component: MessagesPage,
});

function MessagesPage() {
  const { t } = useTranslation();
  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConversations(),
  });

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pt-3 pb-6">
        <h1 className="font-display text-2xl font-bold">{t("messages.title")}</h1>
        {conversations?.length === 0 && (
          <p className="mt-6 text-center text-sm text-muted-foreground">{t("messages.empty")}</p>
        )}
        <ul className="mt-4 divide-y divide-border">
          {conversations?.map((c) => (
            <li key={c.id}>
              <Link
                to="/messages/$conversationId"
                params={{ conversationId: c.id }}
                className="flex items-center gap-3 py-3"
              >
                <img src={c.other.avatarUrl} className="h-11 w-11 rounded-full" alt="" />
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-semibold">{c.other.name}</p>
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {c.lastMessage ?? "…"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
