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
import { AgentModeBadge, AgentFaultCard, AgentEvidenceCard } from "./AgentEnvelopeStatus";
import { isOperationalBlocker } from "@/lib/agent/executionModeBadge";
import { RecommendationTrackerCard } from "@/components/recommendations/RecommendationTrackerCard";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  isDirectionalOpinionOnly,
  trackedRecommendationFromResult,
} from "@/lib/recommendations/fromAgentResult";
import { ChevronDown, TriangleAlert } from "lucide-react";
import type { AgentSuggestion } from "@/lib/agent/suggestions/types";

export interface SmartChartAgentHandle {
  /** Fire the Analyze quick prompt into the chat (used by the header button). */
  quickAnalyze: () => void;
  sendMessage: (message: string, opts?: { inputMode?: "text" | "voice" }) => void;
}

const DECISION_COLOR: Record<AgentFinalResult["decision"], string> = {
  buy: "text-buy",
  sell: "text-sell",
  wait: "text-warning",
  informational: "text-info",
  action_required: "text-warning",
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
  /** Whether the chart surface is showing, for the composer's chart toggle. */
  chartOpen?: boolean;
  onToggleChart?: () => void;
  /** Broker link state + market setters for the composer's pair/interval row. */
  brokerConnected?: boolean;
  onSymbolChange?: (symbol: string, source: "oanda" | "ea") => void;
  onIntervalChange?: (interval: string) => void;
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
      chartOpen,
      onToggleChart,
      brokerConnected,
      onSymbolChange,
      onIntervalChange,
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

    /**
     * One composer element for two placements. Empty conversation: it sits
     * mid-screen under the greeting — the question IS the page, nothing else
     * competes. First message sent: it docks to the bottom for the exchange.
     */
    const isHero = messages.length === 0 && !running;
    const composer = (
      <AgentChatInput
        running={running}
        onSend={sendMessage}
        onCancel={cancel}
        voiceControl={voiceControl}
        chartOpen={chartOpen}
        onToggleChart={onToggleChart}
        symbol={symbol}
        interval={interval}
        brokerConnected={brokerConnected}
        onSymbolChange={onSymbolChange}
        onIntervalChange={onIntervalChange}
      />
    );

    return (
      <div
        className="chat-panel-shell h-full w-full bg-transparent"
        dir={dir}
      >
        {/* No fixed agent header bar and NO static quick-action toolbar — the
            chat panel is clean. All follow-up prompts are dynamic, model-
            generated suggestions rendered per turn (never hardcoded buttons).
            Analysis is reachable from the chart's Analyze control and by typing. */}
        <div className="chat-scroll-region aichart-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {isHero && (
            <div
              data-testid="composer-hero"
              className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center gap-5 text-center"
            >
              <AgentAvatar size={44} state="idle" className="opacity-90" />
              <h2 className="text-balance px-4 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {emptyState.greeting ?? t("agent.empty")}
              </h2>
              <div className="w-full">{composer}</div>
              {emptyState.suggestions.length ? (
                <div className="flex flex-wrap justify-center gap-2 px-4">
                  {emptyState.suggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onClick={() => void sendMessage(suggestion.prompt)}
                      className="min-h-11 rounded-full border border-border bg-background px-3.5 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
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
              data-role={m.role}
              className={
                // Logical auto-margins: `ml-auto` pinned the operator's own
                // messages to the physical right, which is the START edge under
                // dir="rtl" — the side the agent speaks from.
                m.role === "user"
                  ? "ms-auto max-w-[min(85%,36rem)] rounded-2xl bg-[var(--user-bubble)] px-3.5 py-2 text-sm text-foreground"
                  : "me-auto flex max-w-[min(95%,42rem)] gap-2.5 px-1 py-2 text-sm text-foreground"
              }
            >
              {/* Who is speaking, on every agent turn rather than only while it
                  is still thinking. The operator's own messages carry the bubble
                  as their marker and need no avatar. */}
              {m.role === "assistant" && !m.pending ? (
                <AgentAvatar size={24} state="idle" className="mt-0.5 shrink-0" />
              ) : null}
              <div className={m.role === "assistant" ? "min-w-0 flex-1" : undefined}>
              {/* Temporary assistant bubble: live thinking ticker while the run
                  is in flight. Replaced in place by the final answer. */}
              {m.pending ? (
                <div className="flex items-start gap-2.5">
                  <AgentAvatar size={22} state="thinking" className="mt-0.5" />
                  {m.ticker ? (
                    <AgentThinkingTicker item={m.ticker} />
                  ) : (
                    <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/70" />
                      <span>{t("agent.processing")}</span>
                    </div>
                  )}
                </div>
              ) : (
                <>
              {/* Persistent execution-mode badge above every assistant result. */}
              {m.role === "assistant" && m.result?.envelope ? (
                <div className="mb-1">
                  <AgentModeBadge envelope={m.result.envelope} />
                </div>
              ) : null}
              {m.role === "assistant" && isOperationalBlocker(m.result?.envelope) ? (
                <AgentFaultCard envelope={m.result!.envelope!} />
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
              {(() => {
                const tracked = m.result
                  ? trackedRecommendationFromResult(m.result)
                  : null;
                // A recommendation reads best as the card, not as prose: lead
                // with the compact card and fold the long analysis text (plus
                // the reason lists) behind an expandable section. Warnings and
                // evidence never collapse.
                const collapseText =
                  Boolean(tracked) && m.content.trim().length > 200;
                const reasonList = m.result?.keyReasons?.length ? (
                  <ul className="mt-1 list-inside list-disc text-[12px] text-muted-foreground">
                    {m.result.keyReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : null;
                const reasoningSummary = m.result?.publicReasoningSummary
                  ?.length ? (
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
                ) : null;
                return (
                  <>
                    {tracked ? (
                      <div className="mt-1">
                        <RecommendationTrackerCard rec={tracked} />
                      </div>
                    ) : m.result && isDirectionalOpinionOnly(m.result) ? (
                      <div className="mt-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        {t("rec.market_view")}
                      </div>
                    ) : null}
                    {collapseText ? (
                      <details className="group mt-2 rounded-lg border border-border/50 bg-muted/20">
                        <summary className="flex min-h-9 cursor-pointer select-none list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
                          <span className="group-open:hidden">
                            {t("agent.details_expand")}
                          </span>
                          <span className="hidden group-open:inline">
                            {t("agent.details_collapse")}
                          </span>
                        </summary>
                        <div className="border-t border-border/40 px-3 py-2">
                          <p className="whitespace-pre-wrap leading-relaxed">
                            {m.content}
                          </p>
                          {reasonList}
                          {reasoningSummary}
                        </div>
                      </details>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap leading-relaxed">
                          {m.content}
                        </p>
                        {reasonList}
                        {reasoningSummary}
                      </>
                    )}
                  </>
                );
              })()}
              {/* What the read actually rests on (item 13) — never a bare number. */}
              {m.result?.evidenceCard ? (
                <AgentEvidenceCard card={m.result.evidenceCard} />
              ) : null}
              {m.result?.riskWarnings?.length ? (
                <ul className="mt-1 space-y-0.5 text-[12px] text-warning">
                  {m.result.riskWarnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
                </>
              )}
              {m.options?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.options.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => void sendMessage(option.prompt)}
                      disabled={running}
                      className="min-h-11 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50 focus-ring sm:min-h-8"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {m.result?.requiresConfirmation && m.result.confirmationPayload && (
                <div className="mt-2 rounded-lg border border-warning/35 bg-warning/[0.06] p-2 text-[12px]">
                  <p className="font-semibold text-warning">
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
            </div>
          ))}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        {voicePanel}
        {!isHero && (
          <div className="chat-composer-fade" aria-hidden data-testid="composer-fade" />
        )}
        {!isHero && composer}
      </div>
    );
  },
);
