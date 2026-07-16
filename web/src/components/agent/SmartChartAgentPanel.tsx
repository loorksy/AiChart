"use client";

import { useEffect, useImperativeHandle, useState, forwardRef, type ReactNode } from "react";
import type { AgentChartContext, AgentFinalResult } from "@/lib/agent/types";
import {
  useSmartChartAgent,
  type AgentChatMessage,
  type AgentPersistPayload,
} from "@/hooks/useSmartChartAgent";
import { useLocale } from "@/hooks/useLocale";
import { ANALYZE_QUICK_PROMPT } from "@/lib/agent/quickPrompts";
import { AgentThinkingTicker } from "./AgentThinkingTicker";
import { AgentChatInput } from "./AgentChatInput";
import { RecommendationTrackerCard } from "@/components/recommendations/RecommendationTrackerCard";
import {
  isDirectionalOpinionOnly,
  trackedRecommendationFromResult,
} from "@/lib/recommendations/fromAgentResult";
import { TriangleAlert } from "lucide-react";
import type { AgentSuggestion } from "@/lib/agent/suggestions/types";

export interface SmartChartAgentHandle {
  /** Fire the Analyze quick prompt into the chat (used by the header button). */
  quickAnalyze: () => void;
  sendMessage: (message: string, opts?: { inputMode?: "text" | "voice" }) => void;
}

const DECISION_COLOR: Record<AgentFinalResult["decision"], string> = {
  buy: "text-emerald-500",
  sell: "text-red-500",
  wait: "text-amber-500",
  informational: "text-sky-500",
  action_required: "text-fuchsia-500",
};

interface Props {
  symbol: string;
  interval: string;
  layoutId?: string;
  dataSource?: "oanda" | "ea";
  /** Active chat/session id (also the agent sessionId for recommendation memory). */
  chatId?: string;
  /** Messages loaded from history to hydrate this chat. */
  initialMessages?: AgentChatMessage[];
  getVisibleRange?: () => { from: number; to: number } | undefined;
  getLatestCandle?: () => AgentChartContext["latestCandle"] | undefined;
  getDrawings?: () => AgentChartContext["drawings"] | undefined;
  getRecommendation?: () => AgentChartContext["recommendation"] | undefined;
  getUserDrawings?: () => AgentChartContext["userDrawings"] | undefined;
  getSelectedDrawingId?: () => string | undefined;
  onResult?: (result: AgentFinalResult) => void;
  onVoiceFinal?: (result: AgentFinalResult) => void;
  applyDrawingMutations?: (
    commands: NonNullable<AgentFinalResult["drawingMutations"]>,
  ) => void;
  onPersistMessage?: (chatId: string, message: AgentPersistPayload) => void;
  voiceControl?: ReactNode;
  voicePanel?: ReactNode;
}

/** Docked, chart-connected Smart Chart Agent chat — one visible agent. */
export const SmartChartAgentPanel = forwardRef<SmartChartAgentHandle, Props>(
  function SmartChartAgentPanel(
    {
      symbol,
      interval,
      layoutId,
      dataSource,
      chatId,
      initialMessages,
      getVisibleRange,
      getLatestCandle,
      getDrawings,
      getRecommendation,
      getUserDrawings,
      getSelectedDrawingId,
      onResult,
      onVoiceFinal,
      applyDrawingMutations,
      onPersistMessage,
      voiceControl,
      voicePanel,
    },
    ref,
  ) {
    const { t, dir, locale } = useLocale();
    const [emptyState, setEmptyState] = useState<{
      greeting: string | null;
      suggestions: AgentSuggestion[];
    }>({ greeting: null, suggestions: [] });
    const {
      messages,
      running,
      error,
      sendMessage,
      cancel,
    } = useSmartChartAgent({
        symbol,
        interval,
        layoutId,
        dataSource,
        chatId,
        locale,
        initialMessages,
        getVisibleRange,
        getLatestCandle,
        getDrawings,
        getRecommendation,
        getUserDrawings,
        getSelectedDrawingId,
        onResult,
        onVoiceFinal,
        applyDrawingMutations,
        onPersistMessage,
      });
    const drawingsCount = getDrawings?.()?.length ?? 0;

    useEffect(() => {
      if (messages.length || running) return;
      const controller = new AbortController();
      const params = new URLSearchParams({
        symbol,
        interval,
        locale,
        drawings: String(drawingsCount),
      });
      if (chatId) params.set("chatId", chatId);
      void fetch(`/api/agent/suggestions?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => response.ok ? response.json() : null)
        .then((data: { greeting?: string | null; suggestions?: AgentSuggestion[] } | null) => {
          if (!data) return;
          setEmptyState({
            greeting: data.greeting ?? null,
            suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
          });
        })
        .catch(() => undefined);
      return () => controller.abort();
    }, [chatId, drawingsCount, interval, locale, messages.length, running, symbol]);

    useImperativeHandle(
      ref,
      () => ({
        quickAnalyze: () => void sendMessage(ANALYZE_QUICK_PROMPT),
        sendMessage: (m: string, o?: { inputMode?: "text" | "voice" }) =>
          void sendMessage(m, o),
      }),
      [sendMessage],
    );

    return (
      <div
        className="flex h-full min-h-0 w-full flex-col bg-card"
        dir={dir}
      >
        {/* No fixed agent header bar and NO static quick-action toolbar — the
            chat panel is clean. All follow-up prompts are dynamic, model-
            generated suggestions rendered per turn (never hardcoded buttons).
            Analysis is reachable from the chart's Analyze control and by typing. */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 && !running && (
            <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-4 text-center">
              <p className="text-sm text-muted-foreground">
                {emptyState.greeting ?? t("agent.empty")}
              </p>
              {emptyState.suggestions.length ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {emptyState.suggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onClick={() => void sendMessage(suggestion.prompt)}
                      className="min-h-10 rounded-full border border-border/60 bg-background px-3 text-xs text-foreground hover:bg-muted"
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm text-foreground"
                  : "mr-auto max-w-[95%] rounded-xl border border-border/60 bg-card px-3 py-3 text-sm text-foreground shadow-sm"
              }
            >
              {/* Temporary assistant bubble: live thinking ticker while the run
                  is in flight. Replaced in place by the final answer. */}
              {m.pending ? (
                m.ticker ? (
                  <AgentThinkingTicker item={m.ticker} />
                ) : (
                  <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    <span>{t("agent.processing")}</span>
                  </div>
                )
              ) : (
                <>
              {m.role === "assistant" && m.result && (
                <div className="mb-1 flex items-center gap-2 text-[11px]">
                  <span
                    className={`font-bold ${DECISION_COLOR[m.result.decision]}`}
                  >
                    {t(`decision.${m.result.decision}`)}
                  </span>
                  {(m.result.decision === "buy" || m.result.decision === "sell") &&
                  m.result.confidenceSemantics?.displayKind &&
                  m.result.confidenceSemantics.displayKind !== "none" &&
                  typeof m.result.confidenceSemantics.displayValue ===
                    "number" ? (
                    <span className="text-muted-foreground">
                      {t(m.result.confidenceSemantics.displayLabelKey)}{" "}
                      {Math.round(
                        m.result.confidenceSemantics.displayValue * 100,
                      )}
                      %
                    </span>
                  ) : m.result.decision === "wait" ? (
                    <span className="text-muted-foreground">
                      {t("agent.no_actionable_setup")}
                    </span>
                  ) : null}
                </div>
              )}
              <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
              {(() => {
                if (!m.result) return null;
                const tracked = trackedRecommendationFromResult(m.result);
                if (tracked) {
                  return (
                    <div className="mt-2">
                      <RecommendationTrackerCard rec={tracked} />
                    </div>
                  );
                }
                if (isDirectionalOpinionOnly(m.result)) {
                  return (
                    <div className="mt-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      {t("rec.market_view")}
                    </div>
                  );
                }
                return null;
              })()}
              {m.result?.keyReasons?.length ? (
                <ul className="mt-1 list-inside list-disc text-[12px] text-muted-foreground">
                  {m.result.keyReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : null}
              {m.result?.riskWarnings?.length ? (
                <ul className="mt-1 space-y-0.5 text-[12px] text-amber-500">
                  {m.result.riskWarnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {m.result?.publicReasoningSummary?.length ? (
                <div className="mt-2 rounded-md bg-background/50 p-2 text-[12px]">
                  <p className="mb-1 font-medium text-muted-foreground">
                    {t("agent.decision_reason")}
                  </p>
                  <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                    {m.result.publicReasoningSummary.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {m.options?.length ? (
                <div className="mt-2 grid gap-1">
                  {m.options.map((option, index) => (
                    <button
                      key={option.id}
                      onClick={() => void sendMessage(option.prompt)}
                      disabled={running}
                      className="rounded-md border border-border/60 bg-background px-2 py-1 text-start text-xs hover:bg-muted disabled:opacity-50"
                    >
                      {index + 1}. {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {m.result?.requiresConfirmation && m.result.confirmationPayload && (
                <div className="mt-2 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 p-2 text-[12px]">
                  <p className="font-semibold text-fuchsia-500">
                    {t("agent.needs_confirmation")}
                  </p>
                  <p className="text-muted-foreground">
                    {m.result.confirmationPayload.direction === "buy"
                      ? t("decision.buy")
                      : t("decision.sell")}{" "}
                    {m.result.confirmationPayload.symbol} ·{" "}
                  </p>
                </div>
              )}
                </>
              )}
            </div>
          ))}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
              {error}
            </p>
          )}
        </div>

        {voicePanel}
        <AgentChatInput running={running} onSend={sendMessage} onCancel={cancel} voiceControl={voiceControl} />
      </div>
    );
  },
);
