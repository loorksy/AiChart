"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatMessage, AgentPersistPayload } from "@/hooks/useSmartChartAgent";
import type { AgentFinalResult } from "@/lib/agent/types";
import type {
  AgentChatMessageRecord,
  AgentChatSession,
} from "@/lib/agent/chatHistory/types";
import { LS_ACTIVE_CHAT } from "@/lib/chatUrl";

export type ChatUrlSyncMode = "push" | "replace";

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
  /**
   * What the agent panel should be keyed on. Unlike `activeChatId`, this does
   * NOT change when `ensureChat` mints a chat for a send already in flight on
   * the current panel instance — only when the operator switches to a
   * genuinely different conversation (sidebar select, explicit new chat, or
   * a deep-linked chat hydrating on load).
   */
  panelKey: string;
  activeMessages: AgentChatMessage[];
  ready: boolean;
  loadingMessages: boolean;
  selectChat: (id: string, opts?: { skipUrlSync?: boolean }) => void;
  /**
   * Returns to the bare, chat-less workspace. Does NOT create a chat row —
   * that stayed empty in the sidebar for every operator who opened "new
   * chat" and never typed anything. Mints lazily via `ensureChat` on the
   * first actual send, same as the bare `/workspace` landing.
   */
  newChat: () => void;
  /**
   * Home screen has no chat id. The first send creates one, navigates into it,
   * and returns the id so the stream can persist against a real conversation.
   */
  ensureChat: () => Promise<string | null>;
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
  /** Active chat from `/workspace?chat=` — wins over localStorage on first load. */
  urlChatId?: string | null;
  /** Keep the browser URL aligned with the active chat. `null` clears it. */
  syncChatUrl?: (chatId: string | null, mode: ChatUrlSyncMode) => void;
}): UseChatSessions {
  const { enabled, symbol, interval, locale, urlChatId, syncChatUrl } = opts;
  const [sessions, setSessions] = useState<AgentChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [panelKey, setPanelKey] = useState<string>("home");
  const [activeMessages, setActiveMessages] = useState<AgentChatMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  // Lets the initial-load effect's async continuation see whether a send
  // already self-minted a chat (via ensureChat) while that fetch was still
  // in flight, so it doesn't clobber a conversation that's already sending.
  const activeChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const refreshSessions = useCallback(async () => {
    const res = await fetch("/api/agent/chats");
    if (!res.ok) return;
    const json = (await res.json()) as { sessions?: AgentChatSession[] };
    setSessions(json.sessions ?? []);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("aichart:chats-updated"));
    }
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

  // Home (/workspace with no ?chat=) is not a conversation — list the sidebar
  // sessions but do not mint or restore an active chat. Typing + send creates
  // one and navigates into it (ensureChat). A deep link ?chat= still opens.
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
      // A send from the bare welcome screen can self-mint a chat (ensureChat)
      // while this fetch is still in flight, inserting it into `sessions`
      // directly. This snapshot predates that insert and would silently drop
      // it from the sidebar on overwrite — keep it if the fetched list is
      // missing exactly the chat that's currently self-minting.
      setSessions((prev) => {
        const mintedId = activeChatIdRef.current;
        if (!mintedId || list.some((s) => s.id === mintedId)) return list;
        const minted = prev.find((s) => s.id === mintedId);
        return minted ? [minted, ...list] : list;
      });

      // Same race, for activeChatId/activeMessages: don't clobber a
      // conversation that's already sending back to null/[]; just unblock
      // `ready`.
      if (!urlChatId) {
        if (!activeChatIdRef.current) {
          setActiveChatId(null);
          setActiveMessages([]);
        }
        setReady(true);
        return;
      }

      const active = list.find((s) => s.id === urlChatId) ?? null;
      if (!active) {
        if (!activeChatIdRef.current) {
          setActiveChatId(null);
          setActiveMessages([]);
        }
        setReady(true);
        return;
      }
      const msgs = await fetchMessages(active.id);
      if (cancelled) return;
      // Set messages before the id so the (keyed) panel mounts already hydrated.
      setActiveMessages(msgs);
      setActiveChatId(active.id);
      setPanelKey(active.id);
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
    (id: string, selectOpts?: { skipUrlSync?: boolean }) => {
      if (id === activeChatId) return;
      if (!selectOpts?.skipUrlSync) syncChatUrl?.(id, "push");
      void (async () => {
        setLoadingMessages(true);
        try {
          const msgs = await fetchMessages(id);
          // Batched together: the keyed panel remounts already hydrated.
          setActiveMessages(msgs);
          setActiveChatId(id);
          setPanelKey(id);
        } finally {
          setLoadingMessages(false);
        }
      })();
    },
    [activeChatId, fetchMessages, syncChatUrl],
  );

  const newChat = useCallback(() => {
    setActiveMessages([]);
    setActiveChatId(null);
    setPanelKey("home");
    syncChatUrl?.(null, "push");
  }, [syncChatUrl]);

  const ensureChat = useCallback(async (): Promise<string | null> => {
    if (activeChatId) return activeChatId;
    const session = await createChat();
    if (!session) return null;
    setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)]);
    setActiveMessages([]);
    setActiveChatId(session.id);
    // Deliberately NOT setPanelKey here: this mints a chat id for a send
    // already in flight on the current (keyed "home") panel instance. Keying
    // the panel to the new id would remount it mid-send, destroying the
    // useSmartChartAgent instance that owns that send before it can commit
    // the user's message — the panel resets to the empty greeting while the
    // turn keeps running invisibly in an orphaned closure. panelKey only
    // moves once the operator actually switches to a different conversation
    // (selectChat / newChat / a deep-linked chat hydrating on load).
    syncChatUrl?.(session.id, "push");
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_ACTIVE_CHAT, session.id);
      window.dispatchEvent(new Event("aichart:chats-updated"));
    }
    return session.id;
  }, [activeChatId, createChat, syncChatUrl]);

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
      panelKey,
      ensureChat,
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
      panelKey,
      ensureChat,
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
