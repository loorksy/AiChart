"use client";

import { MessageSquarePlus, MessageSquare } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";
import { useLocale } from "@/hooks/useLocale";
import type { AgentChatSession } from "@/lib/agent/chatHistory/types";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SidebarProfileMenu } from "./SidebarProfileMenu";

interface Props {
  sessions: AgentChatSession[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  busy?: boolean;
}

/**
 * Sidebar for the Smart Chart Agent: brand header + language switcher, New Chat,
 * the list of persistent chat sessions (active one highlighted), and the profile
 * menu pinned at the bottom. Direction follows the active locale.
 */
export function AgentChatSidebar({
  sessions,
  activeChatId,
  onSelectChat,
  onNewChat,
  busy,
}: Props) {
  const { t, dir } = useLocale();

  return (
    <aside
      dir={dir}
      className="flex h-full min-h-0 w-full flex-col border-s border-border/60 bg-card"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-3">
        <span className="text-sm font-bold text-foreground">{BRAND_NAME}</span>
        <LanguageSwitcher variant="segmented" />
      </div>

      <div className="shrink-0 px-2">
        <button
          type="button"
          onClick={onNewChat}
          disabled={busy}
          className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {t("nav.new_chat")}
        </button>
      </div>

      <nav
        aria-label={t("nav.chats")}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2"
      >
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            {t("nav.no_chats")}
          </p>
        ) : (
          sessions.map((s) => {
            const active = s.id === activeChatId;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelectChat(s.id)}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-start text-xs ${
                  active
                    ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-foreground">
                    {s.title}
                  </span>
                  {s.lastMessagePreview && (
                    <span className="truncate text-[10px] text-muted-foreground">
                      {s.lastMessagePreview}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </nav>

      <SidebarProfileMenu />
    </aside>
  );
}
