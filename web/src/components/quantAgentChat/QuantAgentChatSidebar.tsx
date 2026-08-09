"use client";

/**
 * Session sidebar for Quant Agent Chat (plan §4) — title, "new chat" button,
 * scrollable session list (title + symbol/date subtitle), delete affordance.
 * Sessions are isolated by `agentId: "quant_agent"` end to end (chatStore),
 * so this list can never show a Lonora session or vice versa.
 */
import { MessageSquarePlus, MessageSquare, Trash2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { AgentChatSession } from "@/lib/agent/chatHistory/types";

export interface QuantAgentChatSidebarProps {
  sessions: AgentChatSession[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
  busy?: boolean;
}

export function QuantAgentChatSidebar({
  sessions,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  busy,
}: QuantAgentChatSidebarProps) {
  const { t, dir, locale } = useLocale();

  return (
    <aside dir={dir} className="flex h-full min-h-0 w-full flex-col rounded-xl border border-border bg-card">
      <div className="shrink-0 border-b border-border p-2">
        <button
          type="button"
          onClick={onNewChat}
          disabled={busy}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50 sm:min-h-9"
        >
          <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          {t("qa.chat.sidebar.new_chat")}
        </button>
      </div>

      <nav aria-label={t("qa.chat.sidebar.title")} className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            {t("qa.chat.sidebar.empty")}
          </p>
        ) : (
          sessions.map((session) => {
            const active = session.id === activeChatId;
            const subtitle = [session.symbol, formatSessionDate(session.updatedAt, locale)]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={session.id}
                className={cn(
                  "group flex w-full items-start gap-1.5 rounded-lg px-1 py-1 text-start text-xs transition-colors",
                  active
                    ? "bg-primary/10 text-foreground ring-1 ring-primary/30"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelectChat(session.id)}
                  className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-1.5 py-1.5"
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-foreground">{session.title}</span>
                    {subtitle ? (
                      <span className="truncate text-[10px] text-muted-foreground">{subtitle}</span>
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteChat(session.id)}
                  aria-label={t("qa.chat.sidebar.delete")}
                  className="me-0.5 mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </nav>
    </aside>
  );
}

function formatSessionDate(updatedAt: number, locale: "ar" | "en"): string {
  try {
    return new Date(updatedAt).toLocaleDateString(locale === "ar" ? "ar" : "en", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
