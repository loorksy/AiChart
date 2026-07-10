"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentChatMessage, AgentPersistPayload } from "@/hooks/useSmartChartAgent";
import type { AgentFinalResult } from "@/lib/agent/types";
import type {
  AgentChatMessageRecord,
  AgentChatSession,
} from "@/lib/agent/chatHistory/types";

const LS_ACTIVE_CHAT = "lonora_active_chat";

/** Map a persisted record to the panel's in-memory message shape. Activity
 *  timelines are intentionally dropped on reload (kept hidden by default). */
function recordToMessage(rec: AgentChatMessageRecord): AgentChatMessage {
  const result = rec.result as AgentFinalResult | undefined;
  return {
    id: rec.id,
    role: rec.role,
    content: rec.content,
    result: rec.role === "assistant" ? result : undefined,
    options: result?.options,
  };
}

export interface UseChatSessions {
  sessions: AgentChatSession[];
  activeChatId: string | null;
  activeMessages: AgentChatMessage[];
  ready: boolean;
  loadingMessages: boolean;
  selectChat: (id: string) => void;
  newChat: () => Promise<void>;
  persistMessage: (chatId: string, message: AgentPersistPayload) => void;
  refreshSessions: () => Promise<void>;
}

/**
 * Owns the persistent chat sessions for the sidebar + agent panel: loads the
 * list, restores the last-active chat across refresh, creates/selects chats,
 * hydrates messages, and persists each turn.
 */
export function useChatSessions(opts: {
  enabled: boolean;
  symbol?: string;
  interval?: string;
  /** Current UI locale — new chats inherit it (stored on the session). */
  locale?: "ar" | "en";
}): UseChatSessions {
  const { enabled, symbol, interval, locale } = opts;
  const [sessions, setSessions] = useState<AgentChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<AgentChatMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const refreshSessions = useCallback(async () => {
    const res = await fetch("/api/agent/chats");
    if (!res.ok) return;
    const json = (await res.json()) as { sessions?: AgentChatSession[] };
    setSessions(json.sessions ?? []);
  }, []);

  const fetchMessages = useCallback(
    async (chatId: string): Promise<AgentChatMessage[]> => {
      const res = await fetch(`/api/agent/chats/${chatId}/messages`);
      if (!res.ok) return [];
      const json = (await res.json()) as { messages?: AgentChatMessageRecord[] };
      return (json.messages ?? []).map(recordToMessage);
    },
    [],
  );

  const createChat = useCallback(async (): Promise<AgentChatSession | null> => {
    const res = await fetch("/api/agent/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, interval, language: locale }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { session?: AgentChatSession };
    return json.session ?? null;
  }, [symbol, interval, locale]);

  // Initialize once on enable: restore last-active or the most recent chat, or
  // create the first one. Keeps at most one reusable empty chat per user.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/agent/chats");
      const json = res.ok
        ? ((await res.json()) as { sessions?: AgentChatSession[] })
        : { sessions: [] };
      if (cancelled) return;
      const list = json.sessions ?? [];
      setSessions(list);

      const stored =
        typeof window !== "undefined"
          ? localStorage.getItem(LS_ACTIVE_CHAT)
          : null;
      let active: AgentChatSession | null =
        list.find((s) => s.id === stored) ?? list[0] ?? null;
      if (!active) {
        active = await createChat();
        if (active && !cancelled) setSessions([active]);
      }
      if (cancelled || !active) {
        setReady(true);
        return;
      }
      const msgs = await fetchMessages(active.id);
      if (cancelled) return;
      // Set messages before the id so the (keyed) panel mounts already hydrated.
      setActiveMessages(msgs);
      setActiveChatId(active.id);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (activeChatId && typeof window !== "undefined") {
      localStorage.setItem(LS_ACTIVE_CHAT, activeChatId);
    }
  }, [activeChatId]);

  const selectChat = useCallback(
    (id: string) => {
      if (id === activeChatId) return;
      void (async () => {
        setLoadingMessages(true);
        try {
          const msgs = await fetchMessages(id);
          // Batched together: the keyed panel remounts already hydrated.
          setActiveMessages(msgs);
          setActiveChatId(id);
        } finally {
          setLoadingMessages(false);
        }
      })();
    },
    [activeChatId, fetchMessages],
  );

  const newChat = useCallback(async () => {
    const session = await createChat();
    if (!session) return;
    setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)]);
    setActiveMessages([]);
    setActiveChatId(session.id);
  }, [createChat]);

  const persistMessage = useCallback(
    (chatId: string, message: AgentPersistPayload) => {
      void (async () => {
        await fetch(`/api/agent/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: message.role,
            content: message.content,
            result: message.result,
            recommendationId: message.recommendationId,
            analysisId: message.analysisId,
            symbol: message.symbol,
            interval: message.interval,
          }),
        }).catch(() => {});
        // Refresh the sidebar so title/preview/order reflect the new turn.
        await refreshSessions();
      })();
    },
    [refreshSessions],
  );

  return useMemo(
    () => ({
      sessions,
      activeChatId,
      activeMessages,
      ready,
      loadingMessages,
      selectChat,
      newChat,
      persistMessage,
      refreshSessions,
    }),
    [
      sessions,
      activeChatId,
      activeMessages,
      ready,
      loadingMessages,
      selectChat,
      newChat,
      persistMessage,
      refreshSessions,
    ],
  );
}
