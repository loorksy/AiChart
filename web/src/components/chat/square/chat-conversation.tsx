"use client";

import { useRef, useEffect } from "react";
import { ChatMessage } from "./chat-message";
import { AgentThinkingTimeline } from "@/components/chat/AgentThinkingTimeline";
import { SSE_CONNECT_ACTIVITY } from "@/lib/agentActivityPipeline";
import type { AgentActivity } from "@/lib/agentActivity";
import type { UiMessage } from "@/stores/chat-store";

interface ChatConversationProps {
  messages: UiMessage[];
  busy?: boolean;
  showActivity?: boolean;
  activities?: AgentActivity[];
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

  const displayActivities: AgentActivity[] =
    showActivity && awaitingResponse
      ? activities.length > 0
        ? activities
        : [SSE_CONNECT_ACTIVITY]
      : showActivity && activities.length > 0
        ? activities
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
      {displayActivities.length > 0 && (
        <div className="px-3 py-2 sm:px-4">
          <AgentThinkingTimeline
            activities={displayActivities}
            onPreview={onPreview}
          />
        </div>
      )}
      <div ref={endRef} className="h-1" />
    </div>
  );
}
