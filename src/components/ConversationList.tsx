import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useTimeAgo } from "@/hooks/use-locale-format";
import { listConversations } from "@/functions/messages";
import { cn } from "@/lib/utils";

/**
 * The inbox as one grouped list. Used full-width on /messages and, from lg, as the side pane of an
 * open thread, so desktop reads as a two-pane messenger instead of one row floating on the canvas.
 */
export function ConversationList({
  activeId,
  className,
}: {
  activeId?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConversations(),
  });

  if (conversations?.length === 0) {
    return <p className="mt-6 text-center text-sm text-muted-foreground">{t("messages.empty")}</p>;
  }

  return (
    <ul className={cn("list-group", className)}>
      {conversations?.map((c) => {
        const active = c.id === activeId;
        return (
          <li key={c.id}>
            <Link
              to="/messages/$conversationId"
              params={{ conversationId: c.id }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-4 py-3.5 outline-none transition-colors focus-visible:bg-muted/50",
                active ? "bg-muted" : "hover:bg-muted/50",
              )}
            >
              <img src={c.other.avatarUrl} className="h-11 w-11 shrink-0 rounded-full" alt="" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.other.name}</p>
                <p className="bidi-auto line-clamp-1 text-xs text-muted-foreground">
                  {c.lastMessage ?? "…"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {timeAgo(c.lastMessageAt)}
                </span>
                {c.unreadCount > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-coral px-1 text-[10px] font-bold text-white">
                    {c.unreadCount}
                  </span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
