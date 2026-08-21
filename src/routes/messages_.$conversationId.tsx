import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { listConversations, listMessages, sendMessage } from "@/functions/messages";
import { useCurrentUser } from "@/hooks/use-current-user";

export const Route = createFileRoute("/messages_/$conversationId")({
  component: ConversationPage,
});

function ConversationPage() {
  const { t } = useTranslation();
  const { conversationId } = Route.useParams();
  const { data: me } = useCurrentUser();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConversations(),
  });
  const conversation = conversations?.find((c) => c.id === conversationId);

  const { data: msgs } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => listMessages({ data: { conversationId } }),
    refetchInterval: 4000,
  });

  const sendMutation = useMutation({
    mutationFn: () => sendMessage({ data: { conversationId, body } }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs?.length]);

  return (
    <AppShell>
      <TopBar />
      <div className="flex h-[calc(100dvh-136px)] flex-col px-4 pt-3">
        <div className="flex items-center gap-2 pb-3">
          <Link to="/messages" className="text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          {conversation && (
            <>
              <img src={conversation.other.avatarUrl} className="h-8 w-8 rounded-full" alt="" />
              <span className="text-sm font-semibold">{conversation.other.name}</span>
            </>
          )}
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto pb-3">
          <AnimatePresence initial={false}>
            {msgs?.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 460, damping: 30 }}
                className={`flex ${m.senderId === me?.id ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    m.senderId === me?.id
                      ? "bg-brand-coral text-white shadow-pop"
                      : "border border-border bg-card"
                  }`}
                >
                  {m.body}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={endRef} />
        </div>

        <form
          className="flex items-center gap-2 border-t border-border py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) sendMutation.mutate();
          }}
        >
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("messages.placeholder")}
            className="flex-1 rounded-full bg-muted px-4 py-2 text-sm outline-none ring-1 ring-border"
          />
          <motion.button
            type="submit"
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            transition={{ type: "spring", stiffness: 450, damping: 22 }}
            className="grid h-10 w-10 place-items-center rounded-full bg-brand-coral shadow-pop-coral"
          >
            <Send className="h-4 w-4 text-white" />
          </motion.button>
        </form>
      </div>
    </AppShell>
  );
}
