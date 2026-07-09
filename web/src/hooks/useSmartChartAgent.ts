"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  AgentActivityEvent,
  AgentChartContext,
  AgentFinalResult,
} from "@/lib/agent/types";

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  result?: AgentFinalResult;
}

export interface UseSmartChartAgentOptions {
  symbol: string;
  interval: string;
  layoutId?: string;
  dataSource?: "oanda" | "ea";
  getVisibleRange?: () => { from: number; to: number } | undefined;
  /** Deliver the agent's drawings to the chart. */
  onResult?: (result: AgentFinalResult) => void;
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
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [activityEvents, setActivityEvents] = useState<AgentActivityEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(uuid());

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  const sendMessage = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || running) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setMessages((prev) => [
        ...prev,
        { id: uuid(), role: "user", content: text },
      ]);
      setActivityEvents([]);
      setError(null);
      setRunning(true);

      const chartContext: AgentChartContext = {
        symbol: opts.symbol,
        interval: opts.interval,
        layoutId: opts.layoutId,
        dataSource: opts.dataSource,
        visibleRange: opts.getVisibleRange?.(),
      };

      try {
        const response = await fetch("/api/agent/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            sessionId: sessionIdRef.current,
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
            if (eventName === "activity") {
              setActivityEvents((prev) => [...prev, data as AgentActivityEvent]);
            } else if (eventName === "final") {
              const result = data as AgentFinalResult;
              setMessages((prev) => [
                ...prev,
                {
                  id: uuid(),
                  role: "assistant",
                  content: result.summary,
                  result,
                },
              ]);
              opts.onResult?.(result);
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
        setRunning(false);
      }
    },
    [opts, running],
  );

  return useMemo(
    () => ({ messages, activityEvents, running, error, sendMessage, cancel }),
    [messages, activityEvents, running, error, sendMessage, cancel],
  );
}
