"use client";

import { useRef, useEffect } from "react";
import { ChatMessage } from "./chat-message";
import { AgentLoadingDots } from "@/components/ui/agent-activity-feed";
import { AgentThinkingTimeline } from "@/components/chat/AgentThinkingTimeline";
import type { AgentActivity } from "@/lib/agentActivity";
import type { UiMessage } from "@/stores/chat-store";

interface ChatConversationProps {
  messages: UiMessage[];
  busy?: boolean;
  showActivity?: boolean;
  activities?: AgentActivity[];
  hideActivityOnMobile?: boolean;
  busyIntentId?: number | null;
  executionMode?: "auto" | "approval" | "direct";
  onIntentApprove?: (id: number) => void;
  onIntentReject?: (id: number) => void;
  onPreview?: () => void;
  onQuestionSelect?: (value: string) => void;
  onWidgetAction?: (action: string, payload: any) => void;
}

export function ChatConversation({
  messages,
  busy,
  showActivity,
  activities = [],
  hideActivityOnMobile = false,
  busyIntentId,
  executionMode,
  onIntentApprove,
  onIntentReject,
  onPreview,
  onQuestionSelect,
  onWidgetAction,
}: ChatConversationProps) {
  const endRef = useRef<HTMLDivElement>(null);

  const pendingAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.streaming);
  const awaitingResponse = busy && Boolean(pendingAssistant);
  const awaitingFirstToken =
    awaitingResponse && !pendingAssistant?.content?.trim();
  const displayActivities =
    showActivity && activities.length > 0
      ? activities
      : awaitingResponse && showActivity
        ? [
            {
              id: "pending-thinking",
              label: "يفكّر ويحلّل",
              status: "running" as const,
            },
          ]
        : [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, activities]);

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain py-3 sm:py-4">
      {messages.map((m) => {
        if (m.role === "assistant" && m.streaming && !m.content.trim()) {
          return null;
        }
        return (
          <ChatMessage
            key={m.id}
            message={m}
            busyIntentId={busyIntentId}
            executionMode={executionMode}
            onIntentApprove={onIntentApprove}
            onIntentReject={onIntentReject}
            onQuestionSelect={onQuestionSelect}
            onWidgetAction={onWidgetAction}
          />
        );
      })}
      {awaitingResponse && (
        <div className="px-3 py-2 sm:px-4">
          {displayActivities.length > 0 ? (
            <div className={hideActivityOnMobile ? "hidden md:block" : undefined}>
              <AgentThinkingTimeline
                activities={displayActivities}
                onPreview={onPreview}
              />
            </div>
          ) : null}
          {(displayActivities.length === 0 || hideActivityOnMobile) && (
            <div
              className={
                hideActivityOnMobile && displayActivities.length > 0
                  ? "md:hidden"
                  : undefined
              }
            >
              {awaitingFirstToken ? <AgentLoadingDots /> : null}
            </div>
          )}
        </div>
      )}
      <div ref={endRef} className="h-1" />
    </div>
  );
}
