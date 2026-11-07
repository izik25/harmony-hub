import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { TopBar } from "@/components/TopBar";
import { ConversationList } from "@/components/ConversationList";
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
    <AppShell width="wide">
      <TopBar />
      {/* From lg: inbox beside the open thread, like any desktop messenger. */}
      <div className="lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-6 lg:px-4">
        <aside className="hidden lg:block lg:h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:pt-6">
          <ConversationList activeId={conversationId} />
        </aside>
        <div className="flex h-[calc(100dvh-136px)] flex-col px-4 pt-3 lg:h-[calc(100dvh-2rem)] lg:px-0 lg:pt-6">
          <div className="-mx-1 flex items-center gap-2 border-b border-border pb-3">
            <Link
              to="/messages"
              aria-label={t("messages.title")}
              className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
            </Link>
            {conversation && (
              <>
                <img src={conversation.other.avatarUrl} className="h-9 w-9 rounded-full" alt="" />
                <span className="font-semibold">{conversation.other.name}</span>
              </>
            )}
          </div>

          <div className="flex-1 space-y-1.5 overflow-y-auto py-4">
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
                    className={`bidi-auto max-w-[75%] whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-[0.9375rem] leading-snug ${
                      m.senderId === me?.id
                        ? "rounded-ee-md bg-brand-coral text-white"
                        : "rounded-es-md border border-border bg-card"
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
              aria-label={t("messages.placeholder")}
              className="input flex-1"
            />
            <motion.button
              type="submit"
              whileTap={{ scale: 0.9 }}
              transition={{ type: "spring", stiffness: 450, damping: 22 }}
              aria-label={t("common.send")}
              disabled={!body.trim() || sendMutation.isPending}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-coral transition-opacity disabled:opacity-40"
            >
              <Send className="h-5 w-5 text-white rtl:-scale-x-100" />
            </motion.button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
