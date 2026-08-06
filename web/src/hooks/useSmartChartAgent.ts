"use client";

import type { MarketDataSource } from "@/lib/markets/marketDataSource";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentActivityEvent,
  AgentChartContext,
  AgentFinalResult,
  AgentOption,
} from "@/lib/agent/types";
import type { AgentTickerItem } from "@/lib/agent/ticker/types";
import type { AgentStageEvent } from "@/lib/agent/stageEvents";
import {
  appendUserAndPending,
  applyFinal,
  applyStreamText,
  applyTicker,
  dropPending,
} from "@/hooks/agentChatReducer";
import { resolveLatestChartCandle } from "@/lib/agent/marketContext/resolveLatestChartCandle";

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  result?: AgentFinalResult;
  /** Meaningful activity captured during this turn — kept in memory for the
   *  optional "run details" toggle; never rendered as a timeline by default. */
  activityEvents?: AgentActivityEvent[];
  /** Clickable follow-up suggestions offered with this reply. */
  options?: AgentOption[];
  /** A temporary assistant bubble shown while the agent runs. Not persisted. */
  pending?: boolean;
  /** Live thinking-ticker line shown inside the pending bubble. */
  ticker?: AgentTickerItem | null;
  /** Live streamed answer text (cumulative, sanitized) for general answers.
   *  UI-only — the final event replaces the whole bubble. */
  streamText?: string | null;
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
  /** How the turn was produced. Voice turns persist as normal text turns. */
  inputMode?: "text" | "voice";
}

export interface UseSmartChartAgentOptions {
  symbol: string;
  interval: string;
  layoutId?: string;
  dataSource?: MarketDataSource;
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
  /** Safe serialized user drawings read from the chart for this turn. */
  getUserDrawings?: () => AgentChartContext["userDrawings"] | undefined;
  /** The user's currently-selected drawing id (highest-priority "this" hint). */
  getSelectedDrawingId?: () => string | undefined;
  /** Deliver the agent's drawings to the chart. */
  onResult?: (result: AgentFinalResult) => void;
  /** Final result of a VOICE-initiated turn — the voice layer speaks its
   *  public answer. Never fired for typed turns. */
  onVoiceFinal?: (result: AgentFinalResult) => void;
  /** Apply user-drawing mutations onto the native chart (after the final SSE). */
  applyDrawingMutations?: (
    commands: NonNullable<AgentFinalResult["drawingMutations"]>,
  ) => void;
  /** Persist a user/assistant message to chat history (fire-and-forget). */
  onPersistMessage?: (chatId: string, message: AgentPersistPayload) => void;
  /**
   * Home has no chat id. Called before the first turn so typing+send creates
   * the conversation and navigates into it.
   */
  ensureChatId?: () => Promise<string | null>;
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
  const [stageEvents, setStageEvents] = useState<AgentStageEvent[]>([]);
  const [currentTicker, setCurrentTicker] = useState<AgentTickerItem | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(opts.chatId ?? uuid());
  // Idempotency: a mutationId is applied to the chart at most once, ever.
  const appliedMutationsRef = useRef<Set<string>>(new Set());

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
    async (message: string, sendOpts?: { inputMode?: "text" | "voice" }) => {
      const text = message.trim();
      if (!text || running) return;
      const inputMode = sendOpts?.inputMode ?? "text";

      // Bare home: mint the conversation before the stream so persistence and
      // the URL land on a real chat id, not a throwaway uuid.
      let chatId = opts.chatId ?? sessionIdRef.current;
      if (!opts.chatId && opts.ensureChatId) {
        try {
          const ensured = await opts.ensureChatId();
          if (ensured) {
            chatId = ensured;
            sessionIdRef.current = ensured;
          }
        } catch {
          // Network failure minting the chat must not vanish the whole send —
          // fall through and stream against the ephemeral session id instead.
        }
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // A temporary assistant bubble hosts the live ticker while the run is in
      // flight; the final event replaces it in place (same id → no duplicate).
      const pendingId = uuid();
      let finalized = false;

      setMessages((prev) =>
        appendUserAndPending(prev, { id: uuid(), content: text }, pendingId),
      );
      setActivityEvents([]);
      setStageEvents([]);
      setError(null);
      setRunning(true);

      // Persist the user turn (fire-and-forget — never blocks streaming).
      opts.onPersistMessage?.(chatId, {
        role: "user",
        content: text,
        symbol: opts.symbol,
        interval: opts.interval,
        inputMode,
      });

      const chartContext: AgentChartContext = {
        symbol: opts.symbol,
        interval: opts.interval,
        layoutId: opts.layoutId,
        dataSource: opts.dataSource,
        visibleRange: opts.getVisibleRange?.(),
        latestCandle: await resolveLatestChartCandle({
          symbol: opts.symbol,
          interval: opts.interval,
          dataSource: opts.dataSource,
          fromChart: opts.getLatestCandle?.(),
        }),
        drawings: opts.getDrawings?.(),
        userDrawings: opts.getUserDrawings?.(),
        selectedDrawingId: opts.getSelectedDrawingId?.(),
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
              // UI-only: drives the pending bubble's line; never stored in history.
              const item = data as AgentTickerItem;
              setCurrentTicker(item);
              setMessages((prev) => applyTicker(prev, pendingId, item));
            } else if (eventName === "answer_text") {
              // Cumulative sanitized text — replace, never append, so a
              // dropped frame cannot corrupt the rendered answer.
              const text = (data as { text?: string }).text;
              if (typeof text === "string" && text) {
                setMessages((prev) => applyStreamText(prev, pendingId, text));
              }
            } else if (eventName === "stage") {
              // Live run-stage checklist for the pending bubble; the final
              // result carries the same list for the persisted message.
              setStageEvents((prev) => [...prev, data as AgentStageEvent]);
            } else if (eventName === "activity") {
              // Live stream only — the server already filtered to visible work.
              setActivityEvents((prev) => [...prev, data as AgentActivityEvent]);
            } else if (eventName === "final") {
              const result = data as AgentFinalResult;
              const turnActivity = result.activityEvents ?? [];
              finalized = true;
              // Replace the pending bubble in place — no duplicate assistant
              // message, and the temporary ticker text is discarded.
              setMessages((prev) =>
                applyFinal(prev, pendingId, {
                  content: result.summary,
                  result,
                  // Kept only for the optional run-details toggle.
                  activityEvents: turnActivity.filter(
                    (e) => e.visible !== false && e.message.trim().length > 0,
                  ),
                  options: result.options ?? [],
                }),
              );
              // Clear the live stream + ticker — the run is over.
              setActivityEvents([]);
              setStageEvents([]);
              setCurrentTicker(null);
              // Only the final event delivers drawings to the chart. Ticker and
              // activity events NEVER touch the chart.
              opts.onResult?.(result);
              // Apply user-drawing mutations exactly once (idempotent by id) —
              // AFTER the final result, never mid-stream.
              const mutations = result.drawingMutations ?? [];
              const fresh = mutations.filter(
                (m) => !appliedMutationsRef.current.has(m.mutationId),
              );
              if (fresh.length) {
                for (const m of fresh) appliedMutationsRef.current.add(m.mutationId);
                opts.applyDrawingMutations?.(fresh);
              }
  // Persist a user-safe result subset (no research transparency / internals).
              opts.onPersistMessage?.(chatId, {
                role: "assistant",
                content: result.summary,
                result: (() => {
                  const {
                    researchEvidence: _r,
                    evidenceTimeline: _e,
                    selectedSkills: _s,
                    skillLoadFailures: _f,
                    debugDecisionFlow: _d,
                    ...safe
                  } = result;
                  return safe;
                })(),
                recommendationId:
                  result.recommendationId ?? result.activeRecommendation?.id,
                analysisId: result.analysisId,
                symbol: opts.symbol,
                interval: opts.interval,
                inputMode,
              });
              // A voice-initiated turn: hand the PUBLIC final answer to the
              // voice layer to speak. Never activity/debug/reasoning.
              if (inputMode === "voice") {
                opts.onVoiceFinal?.(result);
              }
            } else if (eventName === "error") {
              // The failure path now emits a COMPLETE `final` (fallback bubble)
              // before the legacy `error` event. If that final already landed,
              // showing the banner too would surface the same failure twice.
              if (finalized) continue;
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
        // No final arrived (error / cancel / dropped stream) → drop the pending
        // bubble so it never gets stuck showing a ticker.
        if (!finalized) {
          setMessages((prev) => dropPending(prev, pendingId));
        }
      }
    },
    [opts, running],
  );

  return useMemo(
    () => ({
      messages,
      activityEvents,
      stageEvents,
      currentTicker,
      running,
      error,
      sendMessage,
      cancel,
    }),
    [messages, activityEvents, stageEvents, currentTicker, running, error, sendMessage, cancel],
  );
}
