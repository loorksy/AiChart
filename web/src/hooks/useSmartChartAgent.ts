"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentActivityEvent,
  AgentChartContext,
  AgentFinalResult,
  AgentOption,
} from "@/lib/agent/types";
import type { AgentTickerItem } from "@/lib/agent/ticker/types";

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  result?: AgentFinalResult;
  /** Meaningful activity captured during this turn — kept in history. */
  activityEvents?: AgentActivityEvent[];
  /** Clickable follow-up options offered with this reply. */
  options?: AgentOption[];
}

/** Persisted-message payload handed to the chat-history store on each turn. */
export interface AgentPersistPayload {
  role: "user" | "assistant";
  content: string;
  result?: AgentFinalResult;
  recommendationId?: string;
  analysisId?: string;
  symbol?: string;
  interval?: string;
}

export interface UseSmartChartAgentOptions {
  symbol: string;
  interval: string;
  layoutId?: string;
  dataSource?: "oanda" | "ea";
  /** Chat/session id — also used as the agent sessionId so recommendation
   *  memory is scoped per chat. When omitted, an ephemeral id is used. */
  chatId?: string;
  /** UI locale — sent to the agent so it can answer in the selected language. */
  locale?: "ar" | "en";
  /** Messages loaded from history to hydrate this chat on mount. */
  initialMessages?: AgentChatMessage[];
  getVisibleRange?: () => { from: number; to: number } | undefined;
  getLatestCandle?: () => AgentChartContext["latestCandle"] | undefined;
  getDrawings?: () => AgentChartContext["drawings"] | undefined;
  getRecommendation?: () => AgentChartContext["recommendation"] | undefined;
  /** Deliver the agent's drawings to the chart. */
  onResult?: (result: AgentFinalResult) => void;
  /** Persist a user/assistant message to chat history (fire-and-forget). */
  onPersistMessage?: (chatId: string, message: AgentPersistPayload) => void;
}

function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

/**
 * Drives the docked Smart Chart Agent chat: sends a message to the SSE route,
 * streams activity events, and surfaces the single final result (+ drawings).
 * Supports mid-run cancellation via AbortController.
 */
export function useSmartChartAgent(opts: UseSmartChartAgentOptions) {
  const [messages, setMessages] = useState<AgentChatMessage[]>(
    () => opts.initialMessages ?? [],
  );
  const [activityEvents, setActivityEvents] = useState<AgentActivityEvent[]>([]);
  const [currentTicker, setCurrentTicker] = useState<AgentTickerItem | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(opts.chatId ?? uuid());

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCurrentTicker(null);
    setRunning(false);
  }, []);

  // Abort any in-flight stream when the hook unmounts (e.g. switching chats).
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || running) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const chatId = opts.chatId ?? sessionIdRef.current;

      setMessages((prev) => [
        ...prev,
        { id: uuid(), role: "user", content: text },
      ]);
      setActivityEvents([]);
      setError(null);
      setRunning(true);

      // Persist the user turn (fire-and-forget — never blocks streaming).
      opts.onPersistMessage?.(chatId, {
        role: "user",
        content: text,
        symbol: opts.symbol,
        interval: opts.interval,
      });

      const chartContext: AgentChartContext = {
        symbol: opts.symbol,
        interval: opts.interval,
        layoutId: opts.layoutId,
        dataSource: opts.dataSource,
        visibleRange: opts.getVisibleRange?.(),
        latestCandle: opts.getLatestCandle?.(),
        drawings: opts.getDrawings?.(),
        recommendation: opts.getRecommendation?.(),
      };

      try {
        const response = await fetch("/api/agent/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            sessionId: chatId,
            locale: opts.locale,
            chartContext,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const data = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(data?.error ?? "تعذّر بدء الوكيل.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const evLine = chunk
              .split("\n")
              .find((l) => l.startsWith("event:"));
            const dataLine = chunk
              .split("\n")
              .find((l) => l.startsWith("data:"));
            if (!evLine || !dataLine) continue;
            const eventName = evLine.slice(6).trim();
            let data: unknown;
            try {
              data = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }
            if (eventName === "ticker") {
              // UI-only: one changing line while running; never stored in history.
              setCurrentTicker(data as AgentTickerItem);
            } else if (eventName === "activity") {
              // Live stream only — the server already filtered to visible work.
              setActivityEvents((prev) => [...prev, data as AgentActivityEvent]);
            } else if (eventName === "final") {
              const result = data as AgentFinalResult;
              const turnActivity = result.activityEvents ?? [];
              setMessages((prev) => [
                ...prev,
                {
                  id: uuid(),
                  role: "assistant",
                  content: result.summary,
                  result,
                  // Persist meaningful activity into history so it doesn't vanish.
                  activityEvents: turnActivity.filter(
                    (e) => e.visible !== false && e.message.trim().length > 0,
                  ),
                  options: result.options ?? [],
                },
              ]);
              // Clear the live stream + ticker — the run is over.
              setActivityEvents([]);
              setCurrentTicker(null);
              // Only the final event delivers drawings to the chart. Ticker and
              // activity events NEVER touch the chart.
              opts.onResult?.(result);
              // Persist the assistant turn with its result + references.
              opts.onPersistMessage?.(chatId, {
                role: "assistant",
                content: result.summary,
                result,
                recommendationId:
                  result.recommendationId ?? result.activeRecommendation?.id,
                analysisId: result.analysisId,
                symbol: opts.symbol,
                interval: opts.interval,
              });
            } else if (eventName === "error") {
              const msg =
                (data as { error?: string }).error ?? "حدث خطأ في الوكيل.";
              setError(msg);
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // user cancelled — no error surfaced
        } else {
          setError(
            err instanceof Error ? err.message : "حدث خطأ أثناء تشغيل الوكيل.",
          );
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setCurrentTicker(null);
        setRunning(false);
      }
    },
    [opts, running],
  );

  return useMemo(
    () => ({
      messages,
      activityEvents,
      currentTicker,
      running,
      error,
      sendMessage,
      cancel,
    }),
    [messages, activityEvents, currentTicker, running, error, sendMessage, cancel],
  );
}
