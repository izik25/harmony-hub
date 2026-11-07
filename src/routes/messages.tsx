import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { ConversationList } from "@/components/ConversationList";
import { listConversations } from "@/functions/messages";

export const Route = createFileRoute("/messages")({
  component: MessagesPage,
});

function MessagesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConversations(),
  });

  // On desktop the inbox is a two-pane messenger: open the latest conversation beside the list
  // (the thread route renders both) instead of one list floating on a wide canvas. Phones and
  // tablets keep the list as its own screen.
  const latestId = conversations?.[0]?.id;
  useEffect(() => {
    if (!latestId) return;
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    navigate({
      to: "/messages/$conversationId",
      params: { conversationId: latestId },
      replace: true,
    });
  }, [latestId, navigate]);

  return (
    <AppShell>
      <TopBar />
      <div className="px-4 pb-8 pt-6">
        <h1 className="page-title">{t("messages.title")}</h1>
        <ConversationList className="mt-5" />
      </div>
    </AppShell>
  );
}
