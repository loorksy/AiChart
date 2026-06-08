"use client";

import { useRef, useEffect } from "react";
import { ChatMessage } from "./chat-message";
import {
  AgentActivityFeed,
  AgentLoadingDots,
} from "@/components/ui/agent-activity-feed";
import type { AgentActivity } from "@/lib/agentActivity";
import type { UiMessage } from "@/stores/chat-store";

interface ChatConversationProps {
  messages: UiMessage[];
  busy?: boolean;
  showActivity?: boolean;
  activities?: AgentActivity[];
  hideActivityOnMobile?: boolean;
}

export function ChatConversation({
  messages,
  busy,
  showActivity,
  activities = [],
  hideActivityOnMobile = false,
}: ChatConversationProps) {
  const endRef = useRef<HTMLDivElement>(null);

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const awaitingFirstToken =
    busy && !lastAssistant?.content?.trim();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, activities]);

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain py-3 sm:py-4">
      {messages.map((m) => {
        if (m.role === "assistant" && m.streaming && !m.content.trim()) {
          return null;
        }
        return <ChatMessage key={m.id} message={m} />;
      })}
      {awaitingFirstToken && (
        <div className="px-3 py-2 sm:px-4">
          {showActivity && activities.length > 0 ? (
            <div className={hideActivityOnMobile ? "hidden md:block" : undefined}>
              <AgentActivityFeed activities={activities} />
            </div>
          ) : null}
          {(!showActivity || activities.length === 0 || hideActivityOnMobile) && (
            <div className={hideActivityOnMobile && showActivity && activities.length > 0 ? "md:hidden" : undefined}>
              <AgentLoadingDots />
            </div>
          )}
        </div>
      )}
      <div ref={endRef} className="h-1" />
    </div>
  );
}
