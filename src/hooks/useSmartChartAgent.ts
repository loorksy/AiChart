"use client";

import type { MarketDataSource } from "@/lib/markets/marketDataSource";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notifyBillingChanged } from "@/hooks/useBillingSummary";
import type {
  AgentActivityEvent,
  AgentChartContext,
  AgentFinalResult,
  AgentOption,
} from "@/lib/agent/types";
import type { AgentStageEvent } from "@/lib/agent/stageEvents";
import {
  appendUserAndPending,
  applyFinal,
  applyStreamText,
  applyLiveNote,
  applyThinking,
  dropPending,
} from "@/hooks/agentChatReducer";
import { resolveLatestChartCandle } from "@/lib/agent/marketContext/resolveLatestChartCandle";
import {
  beginLiveRun,
  endLiveRun,
  getLiveRun,
  subscribeLiveRun,
  updateLiveRun,
} from "@/lib/agent/liveRunStore";
import { APP_WAKE_EVENT, tickReconnectDelayMs } from "@/lib/appWake";
import {
  pickRecoveredAssistant,
  type RecoverableChatMessage,
} from "@/lib/agent/recoverPendingTurn";
import { t } from "@/lib/i18n";

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
  /** Latest engine narration line shown inside the pending bubble. */
  liveNote?: string | null;
  /** Live thinking lines (server `thinking` SSE events — real per-step
   *  narration derived from run evidence). UI-only, never persisted. */
  thinking?: string[] | null;
  /** Live streamed answer text (cumulative, sanitized) for general answers.
   *  UI-only — the final event replaces the whole bubble. */
  streamText?: string | null;
  /** Wall-clock of this turn (ms). Shown next to the copy control. */
  createdAt?: number;
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
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A named account-state refusal from the server. The SERVER decides both
  // the sentence and the next step (the same empty balance means "subscribe"
  // for a Free account and "top up" for a subscriber), so the client stores
  // that decision rather than re-deriving it. Plain errors stay in `error`.
  const [billingRefusal, setBillingRefusal] = useState<{
    message: string;
    ctaLabel: string;
    ctaPath: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Work B: the server names each turn (X-Turn-Id). Under the queue,
  // aborting the fetch only stops the RELAY — the worker keeps running and
  // the answer lands in history — so the cancel button also posts an
  // explicit cancel for this turn id.
  const activeTurnIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string>(opts.chatId ?? uuid());
  // Idempotency: a mutationId is applied to the chart at most once, ever.
  const appliedMutationsRef = useRef<Set<string>>(new Set());
  const recoverRef = useRef<{
    chatId: string;
    pendingId: string;
    userContent: string;
    inputMode: "text" | "voice";
  } | null>(null);
  const recoverInFlightRef = useRef(false);

  const cancel = useCallback(() => {
    const turnId = activeTurnIdRef.current;
    if (turnId) {
      activeTurnIdRef.current = null;
      void fetch("/api/agent/chat/stream/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId }),
      }).catch(() => {});
    }
    abortRef.current?.abort();
    abortRef.current = null;
    recoverRef.current = null;
    setLiveNote(null);
    setRunning(false);
    setReconnecting(false);
    // An explicit cancel forgets the live run — nothing to re-attach to.
    endLiveRun(sessionIdRef.current);
  }, []);

  const recoverLoopRef = useRef<() => Promise<void>>(async () => {});

  const claimRecovered = useCallback(
    async (job: {
      chatId: string;
      pendingId: string;
      userContent: string;
      inputMode: "text" | "voice";
    }): Promise<boolean> => {
      const res = await fetch(
        `/api/agent/chats/${encodeURIComponent(job.chatId)}/messages`,
      );
      if (!res.ok) return false;
      const json = (await res.json()) as { messages?: RecoverableChatMessage[] };
      const found = pickRecoveredAssistant(json.messages ?? [], job.userContent);
      if (!found) return false;

      const result = found.result;
      if (result) {
        const turnActivity = result.activityEvents ?? [];
        updateLiveRun(job.chatId, job.pendingId, {
          running: false,
          final: {
            result,
            content: found.content,
            activityEvents: turnActivity.filter(
              (e) => e.visible !== false && e.message.trim().length > 0,
            ),
            options: result.options ?? found.options ?? [],
          },
        });
        setMessages((prev) =>
          applyFinal(prev, job.pendingId, {
            content: found.content,
            result,
            activityEvents: turnActivity.filter(
              (e) => e.visible !== false && e.message.trim().length > 0,
            ),
            options: result.options ?? found.options ?? [],
            createdAt: found.createdAt,
          }),
        );
        opts.onResult?.(result);
        const mutations = result.drawingMutations ?? [];
        const fresh = mutations.filter(
          (m) => !appliedMutationsRef.current.has(m.mutationId),
        );
        if (fresh.length) {
          for (const m of fresh) appliedMutationsRef.current.add(m.mutationId);
          opts.applyDrawingMutations?.(fresh);
        }
        if (job.inputMode === "voice") opts.onVoiceFinal?.(result);
      } else {
        setMessages((prev) =>
          applyFinal(prev, job.pendingId, {
            content: found.content,
            createdAt: found.createdAt,
          }),
        );
      }

      recoverRef.current = null;
      setReconnecting(false);
      setRunning(false);
      setLiveNote(null);
      setActivityEvents([]);
      setStageEvents([]);
      setError(null);
      endLiveRun(job.chatId, job.pendingId);
      return true;
    },
    [opts],
  );

  const recoverLoop = useCallback(async () => {
    const job = recoverRef.current;
    if (!job || recoverInFlightRef.current) return;
    recoverInFlightRef.current = true;
    try {
      const deadline = Date.now() + 4 * 60_000;
      let attempt = 0;
      while (Date.now() < deadline) {
        if (recoverRef.current !== job) return;
        try {
          if (await claimRecovered(job)) return;
        } catch {
          /* still down — wait and try again */
        }
        await new Promise((r) =>
          setTimeout(r, tickReconnectDelayMs(attempt) + 800),
        );
        attempt += 1;
      }
      if (recoverRef.current !== job) return;
      recoverRef.current = null;
      setReconnecting(false);
      setRunning(false);
      setLiveNote(null);
      setError(t(opts.locale ?? "ar", "agent.error"));
      setMessages((prev) => dropPending(prev, job.pendingId));
      updateLiveRun(job.chatId, job.pendingId, { running: false });
    } finally {
      recoverInFlightRef.current = false;
    }
  }, [claimRecovered, opts.locale]);

  // Refs may not be written during render; every reader runs post-await in
  // event/stream handlers, so an effect-time write is always fresh enough.
  useEffect(() => {
    recoverLoopRef.current = recoverLoop;
  }, [recoverLoop]);

  useEffect(() => {
    const onWake = () => {
      if (recoverRef.current) void recoverLoop();
    };
    window.addEventListener(APP_WAKE_EVENT, onWake);
    window.addEventListener("online", onWake);
    return () => {
      window.removeEventListener(APP_WAKE_EVENT, onWake);
      window.removeEventListener("online", onWake);
    };
  }, [recoverLoop]);

  // Navigation persistence (Phase 3): the stream is NOT aborted on unmount.
  // The loop keeps running (state setters on an unmounted hook are no-ops),
  // mirrors into the live-run store, and a remounted hook re-attaches below.

  // Re-attach to this chat's live run after a remount, and follow it live.
  useEffect(() => {
    const chatId = opts.chatId ?? sessionIdRef.current;
    const sync = () => {
      const run = getLiveRun(chatId);
      if (!run) return;
      if (run.running) {
        setRunning(true);
        setStageEvents(run.stageEvents);
        setLiveNote(run.liveNote);
        setMessages((prev) => {
          const hasPending = prev.some((m) => m.id === run.pendingId);
          if (hasPending) {
            return prev.map((m) =>
              m.id === run.pendingId && m.pending
                ? {
                    ...m,
                    liveNote: run.liveNote,
                    streamText: run.streamText,
                    thinking: run.thinking.length ? [...run.thinking] : m.thinking,
                  }
                : m,
            );
          }
          // Rebuild the bubble. The user turn was persisted at send time, so
          // it is usually already in history — only add it when it is not.
          const lastUser = [...prev].reverse().find((m) => m.role === "user");
          const needUser = lastUser?.content !== run.userMessage;
          return [
            ...prev,
            ...(needUser
              ? [{ id: `${run.pendingId}-user`, role: "user" as const, content: run.userMessage }]
              : []),
            {
              id: run.pendingId,
              role: "assistant" as const,
              content: "",
              pending: true,
              liveNote: run.liveNote,
              streamText: run.streamText,
              thinking: run.thinking.length ? [...run.thinking] : null,
            },
          ];
        });
        return;
      }
      // The run ended while we were away (or just now).
      if (run.final) {
        const final = run.final;
        setMessages((prev) => {
          // Only the still-live pending bubble is replaced. Without one,
          // persisted history is authoritative — applying again would
          // duplicate the answer under a second id.
          const hasPending = prev.some((m) => m.id === run.pendingId && m.pending);
          if (!hasPending) return prev;
          return applyFinal(prev, run.pendingId, {
            content: final.content,
            result: final.result,
            activityEvents: final.activityEvents,
            options: final.options,
          });
        });
      } else {
        setMessages((prev) => dropPending(prev, run.pendingId));
      }
      setRunning(false);
      setStageEvents([]);
      setLiveNote(null);
      endLiveRun(chatId, run.pendingId);
    };
    sync();
    return subscribeLiveRun(chatId, sync);
  }, [opts.chatId]);

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
      // A temporary assistant bubble hosts the live narration while the run is in
      // flight; the final event replaces it in place (same id → no duplicate).
      const pendingId = uuid();
      let finalized = false;
      let httpFailed = false;

      setMessages((prev) =>
        appendUserAndPending(prev, { id: uuid(), content: text }, pendingId),
      );
      setActivityEvents([]);
      setStageEvents([]);
      setError(null);
      setRunning(true);
      beginLiveRun({ chatId, pendingId, userMessage: text });

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
          httpFailed = true;
          const data = (await response.json().catch(() => null)) as
            | {
                error?: string;
                code?: string;
                cta?: { label: string; path: string };
              }
            | null;
          if (data?.code && data.cta) {
            setBillingRefusal({
              message: data.error ?? "",
              ctaLabel: data.cta.label,
              ctaPath: data.cta.path,
            });
          }
          throw new Error(data?.error ?? t(opts.locale ?? "ar", "agent.error"));
        }

        // Work B transport: the queue relay stamps each frame with an `id:`
        // line (the stream cursor) and names the turn in X-Turn-Id. Event
        // names and payloads are unchanged — the two extras only feed the
        // explicit cancel and the live resume below.
        activeTurnIdRef.current = response.headers.get("x-turn-id");
        let resumeCursor: string | null = null;

        const handleChunk = (chunk: string) => {
            const lines = chunk.split("\n");
            const idLine = lines.find((l) => l.startsWith("id:"));
            if (idLine) resumeCursor = idLine.slice(3).trim();
            const evLine = lines.find((l) => l.startsWith("event:"));
            const dataLine = lines.find((l) => l.startsWith("data:"));
            if (!evLine || !dataLine) return;
            const eventName = evLine.slice(6).trim();
            let data: unknown;
            try {
              data = JSON.parse(dataLine.slice(5).trim());
            } catch {
              return;
            }
            if (eventName === "answer_text") {
              // Cumulative sanitized text — replace, never append, so a
              // dropped frame cannot corrupt the rendered answer.
              const text = (data as { text?: string }).text;
              if (typeof text === "string" && text) {
                setMessages((prev) => applyStreamText(prev, pendingId, text));
                updateLiveRun(chatId, pendingId, { streamText: text });
              }
            } else if (eventName === "stage") {
              // Live run-stage checklist for the pending bubble; the final
              // result carries the same list for the persisted message.
              setStageEvents((prev) => [...prev, data as AgentStageEvent]);
              updateLiveRun(chatId, pendingId, {
                addStageEvent: data as AgentStageEvent,
              });
            } else if (eventName === "thinking") {
              // The agent's own reasoning line for this step — composed
              // server-side from real run evidence (thinkingNarration.ts),
              // scrubbed of internals, and appended to the pending bubble's
              // collapsible trace. UI-only, never persisted.
              const line = (data as { text?: string }).text;
              if (typeof line === "string" && line.trim()) {
                setMessages((prev) => applyThinking(prev, pendingId, line));
                updateLiveRun(chatId, pendingId, { addThought: line });
              }
            } else if (eventName === "activity") {
              // Live stream only — the server already filtered to visible work.
              const event = data as AgentActivityEvent;
              setActivityEvents((prev) => [...prev, event]);
              // The bubble's narration line IS this stream: the specialist's
              // own sentence, at the moment its work finished. Nothing
              // pre-generated ever writes here.
              if (event.message?.trim()) {
                setLiveNote(event.message);
                setMessages((prev) => applyLiveNote(prev, pendingId, event.message));
                updateLiveRun(chatId, pendingId, { liveNote: event.message });
              }
            } else if (eventName === "final") {
              const result = data as AgentFinalResult;
              const turnActivity = result.activityEvents ?? [];
              finalized = true;
              // A completed turn may have consumed trial or credits —
              // refresh the badge and balance instantly, no reload.
              notifyBillingChanged();
              // Store first: if this instance is unmounted, the subscription
              // on the next mount claims the final from here.
              updateLiveRun(chatId, pendingId, {
                running: false,
                final: {
                  result,
                  content: result.summary,
                  activityEvents: turnActivity.filter(
                    (e) => e.visible !== false && e.message.trim().length > 0,
                  ),
                  options: result.options ?? [],
                },
              });
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
              setLiveNote(null);
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
              if (finalized) return;
              const msg =
                (data as { error?: string }).error ?? t(opts.locale ?? "ar", "agent.error");
              setError(msg);
            }
        };

        const pumpStream = async (res: Response) => {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) handleChunk(chunk);
          }
        };

        // Live resume (queue relay only): re-attach from the last cursor —
        // the worker kept running, so nothing is lost and nothing replays
        // twice. A non-OK response means the relay is gone (inline mode or
        // expired stream) and history recovery below takes over.
        const attemptLiveResume = async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (finalized || controller.signal.aborted) return;
            const turnId = activeTurnIdRef.current;
            if (!turnId || !resumeCursor) return;
            try {
              const res = await fetch(
                `/api/agent/chat/stream?turn=${encodeURIComponent(turnId)}&cursor=${encodeURIComponent(resumeCursor)}`,
                { signal: controller.signal },
              );
              if (!res.ok || !res.body) return;
              await pumpStream(res);
            } catch (err) {
              if (err instanceof DOMException && err.name === "AbortError") return;
              await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
            }
          }
        };

        try {
          await pumpStream(response);
        } catch (err) {
          // An abort stays an abort; any other mid-stream drop falls
          // through to live resume, then to history recovery.
          if (err instanceof DOMException && err.name === "AbortError") throw err;
        }
        await attemptLiveResume();
        if (!finalized && !controller.signal.aborted) {
          recoverRef.current = { chatId, pendingId, userContent: text, inputMode };
          setReconnecting(true);
          setError(null);
          setRunning(true);
          updateLiveRun(chatId, pendingId, { running: true });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // user cancelled — no error surfaced
        } else if (httpFailed) {
          setError(
            err instanceof Error ? err.message : t(opts.locale ?? "ar", "agent.error"),
          );
        } else {
          // Stream / network dropped after the run started (or the POST may
          // have reached the server). Keep the pending bubble and claim the
          // persisted final once the socket is back.
          recoverRef.current = { chatId, pendingId, userContent: text, inputMode };
          setReconnecting(true);
          setError(null);
          setRunning(true);
          updateLiveRun(chatId, pendingId, { running: true });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (finalized) {
          activeTurnIdRef.current = null;
          setLiveNote(null);
          setRunning(false);
        } else if (recoverRef.current?.pendingId === pendingId) {
          void recoverLoopRef.current();
        } else {
          setLiveNote(null);
          setRunning(false);
          setReconnecting(false);
          setMessages((prev) => dropPending(prev, pendingId));
          updateLiveRun(chatId, pendingId, { running: false });
        }
      }
    },
    [opts, running],
  );

  const clearBillingRefusal = useCallback(() => setBillingRefusal(null), []);

  return useMemo(
    () => ({
      messages,
      activityEvents,
      stageEvents,
      liveNote,
      running,
      reconnecting,
      error,
      billingRefusal,
      clearBillingRefusal,
      sendMessage,
      cancel,
    }),
    [
      messages,
      activityEvents,
      stageEvents,
      liveNote,
      running,
      reconnecting,
      error,
      billingRefusal,
      clearBillingRefusal,
      sendMessage,
      cancel,
    ],
  );
}
