"use client";

import type { MarketDataSource } from "@/lib/markets/marketDataSource";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
  type ReactNode,
} from "react";
import { useChatStickToBottom } from "@/hooks/useChatStickToBottom";
import type { AgentChartContext, AgentFinalResult } from "@/lib/agent/types";
import {
  useSmartChartAgent,
  type AgentChatMessage,
  type AgentPersistPayload,
} from "@/hooks/useSmartChartAgent";
import { useLocale } from "@/hooks/useLocale";
import { ANALYZE_QUICK_PROMPT } from "@/lib/agent/quickPrompts";
import { AgentThinkingTraceLive } from "./AgentThinkingTrace";
import { AgentChatInput } from "./AgentChatInput";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";
import { AgentModeBadge, AgentFaultCard, AgentPresentationFacts } from "./AgentEnvelopeStatus";
import { AgentCards } from "./cards/AgentCards";
import { isOperationalBlocker } from "@/lib/agent/envelopeBadge";
import { RecommendationTrackerCard } from "@/components/recommendations/RecommendationTrackerCard";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  isDirectionalOpinionOnly,
  trackedRecommendationFromResult,
} from "@/lib/recommendations/fromAgentResult";
import { ChevronDown } from "lucide-react";
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
  dataSource?: MarketDataSource;
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
  ensureChatId?: () => Promise<string | null>;
  /** Broker link state + market setters for the composer's pair/interval row. */
  brokerConnected?: boolean;
  onSymbolChange?: (symbol: string, source: MarketDataSource) => void;
  onIntervalChange?: (interval: string) => void;
  /**
   * A conversation is being hydrated from history. Suppresses the hero
   * landing (which used to flash while messages loaded) in favour of a
   * conversation skeleton — the two surfaces stay visually separate.
   */
  hydrating?: boolean;
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
      ensureChatId,
      brokerConnected,
      onSymbolChange,
      onIntervalChange,
      hydrating = false,
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
      stageEvents,
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
        ensureChatId,
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

    /**
     * One composer element for two placements. Empty conversation: it sits
     * mid-screen under the greeting — the question IS the page, nothing else
     * competes. First message sent: it docks to the bottom for the exchange.
     * While a history conversation hydrates, NEITHER surface is the hero —
     * the skeleton keeps the landing and the conversation strictly separate.
     */
    const isHero = messages.length === 0 && !running && !hydrating;
    const last = messages[messages.length - 1];
    const followKey = [
      messages.length,
      last?.id ?? "",
      last?.pending ? "p" : "d",
      last?.streamText?.length ?? 0,
      last?.content.length ?? 0,
      stageEvents.length,
      running ? "1" : "0",
      hydrating ? "h" : "r",
    ].join(":");
    const { scrollerRef, pin } = useChatStickToBottom(!isHero, followKey, chatId ?? "");
    const panelRef = useRef<HTMLDivElement>(null);
    const composerDockRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      if (isHero) return;
      const dock = composerDockRef.current;
      const panel = panelRef.current;
      if (!dock || !panel) return;
      const apply = () => {
        panel.style.setProperty("--composer-height", `${dock.offsetHeight}px`);
      };
      apply();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(apply);
      observer.observe(dock);
      return () => {
        observer.disconnect();
        panel.style.removeProperty("--composer-height");
      };
    }, [isHero]);

    const sendAndFollow = useCallback(
      (message: string, opts?: { inputMode?: "text" | "voice" }) => {
        pin();
        return sendMessage(message, opts);
      },
      [pin, sendMessage],
    );

    useImperativeHandle(
      ref,
      () => ({
        quickAnalyze: () => void sendAndFollow(ANALYZE_QUICK_PROMPT),
        sendMessage: (m: string, o?: { inputMode?: "text" | "voice" }) =>
          void sendAndFollow(m, o),
      }),
      [sendAndFollow],
    );
    const composer = (
      <AgentChatInput
        running={running}
        onSend={sendAndFollow}
        onCancel={cancel}
        symbol={symbol}
        interval={interval}
        brokerConnected={brokerConnected}
        onSymbolChange={onSymbolChange}
        onIntervalChange={onIntervalChange}
      />
    );

    return (
      <div
        ref={panelRef}
        className="chat-panel-shell h-full w-full bg-transparent"
        dir={dir}
      >
        {/* No fixed agent header bar and NO static quick-action toolbar — the
            chat panel is clean. All follow-up prompts are dynamic, model-
            generated suggestions rendered per turn (never hardcoded buttons).
            Analysis is reachable from the chart's Analyze control and by typing. */}
        <div
          ref={scrollerRef}
          data-testid="chat-scroll-region"
          data-hero={isHero || undefined}
          className={
            isHero
              ? "chat-scroll-region aichart-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-3"
              : "chat-scroll-region aichart-scroll min-h-0 flex-1 overflow-y-auto p-3"
          }
        >
          {isHero && (
            <div
              data-testid="composer-hero"
              className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 text-center"
            >
              <AgentAvatar size={44} state="idle" className="opacity-90" />
              <h2 className="font-serif text-balance px-4 text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
                {emptyState.greeting ?? t("agent.empty")}
              </h2>
              <div className="w-full">{composer}</div>
              {emptyState.suggestions.length ? (
                <div className="flex flex-wrap justify-center gap-2 px-4">
                  {emptyState.suggestions.map((suggestion) => (
                    <LiquidMetalButton
                      key={suggestion.id}
                      label={suggestion.label}
                      onClick={() => void sendAndFollow(suggestion.prompt)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {!isHero && (
          <div className="flex flex-col space-y-3">
          {hydrating && messages.length === 0 && (
            <div
              data-testid="chat-hydrating"
              className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-1 pt-6"
              aria-busy="true"
            >
              <div className="ms-auto h-9 w-2/5 animate-pulse rounded-2xl bg-muted" />
              <div className="space-y-2.5">
                <div className="h-4 w-11/12 animate-pulse rounded bg-muted/70" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted/70" />
                <div className="h-4 w-4/6 animate-pulse rounded bg-muted/50" />
              </div>
              <div className="ms-auto h-9 w-1/3 animate-pulse rounded-2xl bg-muted" />
              <div className="space-y-2.5">
                <div className="h-4 w-5/6 animate-pulse rounded bg-muted/70" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              data-role={m.role}
              className={
                // Claude-style thread: one centred reading column. The
                // operator's own messages sit in a soft bubble on the END
                // edge (logical margins keep RTL correct); the agent answers
                // as plain text across the column — no bubble, no avatar.
                m.role === "user"
                  ? "mx-auto w-full max-w-3xl"
                  : "mx-auto w-full max-w-3xl px-1 py-2 text-[0.9375rem] leading-7 text-foreground"
              }
            >
              {m.role === "user" ? (
                <div className="ms-auto w-fit max-w-[min(85%,36rem)] rounded-2xl bg-[var(--user-bubble)] px-3.5 py-2 text-sm leading-6 text-foreground">
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ) : (
              <div className="min-w-0">
              {/* Temporary assistant turn: the Claude-style trace runs while
                  the pipeline is in flight — real stages, collapsed by
                  default — and the final answer replaces it in place. */}
              {m.pending ? (
                <div className="min-w-0">
                  <AgentThinkingTraceLive events={stageEvents} liveNote={m.liveNote} />
                  {m.streamText ? (
                    /* Live streamed answer (general questions): the text
                       grows in place; the final event replaces the bubble. */
                    <p className="whitespace-pre-wrap py-0.5 leading-7 text-foreground">
                      {m.streamText}
                      <span className="ms-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-foreground/60 align-middle" />
                    </p>
                  ) : null}
                </div>
              ) : (
                <>
              {/* Persistent execution-mode badge above every assistant result. */}
              {m.role === "assistant" && m.result?.envelope ? (
                <div className="mb-1">
                  <AgentModeBadge envelope={m.result.envelope} />
                </div>
              ) : null}
              {m.role === "assistant" && m.result?.envelope ? (
                <AgentPresentationFacts envelope={m.result.envelope} />
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
                // The reason lists, the evidence, the warnings and the stages
                // used to be built here as four more inline conditionals. They
                // are cards now — see `AgentCards` — so this closure is back to
                // owning only the message TEXT and whether it folds.
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
                        </div>
                      </details>
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {m.content}
                      </p>
                    )}
                  </>
                );
              })()}
              {/* Everything the run produced, in one place and in reading
                  order. What used to be four inline conditionals here — the
                  evidence, the stages, the warnings, the options — is now a
                  closed set of card types that the phone renders from the same
                  derivation. The gate checklist, the invalidation level, the
                  cost basis and the research contributions were computed and
                  shipped to this browser all along, and never drawn until now. */}
              {m.result ? (
                <AgentCards
                  result={m.result}
                  onOption={(prompt) => void sendAndFollow(prompt)}
                  disabled={running}
                />
              ) : null}
                </>
              )}
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
              )}
            </div>
          ))}

          {error && (
            <p className="mx-auto w-full max-w-3xl rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          </div>
          )}
        </div>

        {!isHero && (
          <div ref={composerDockRef} className="chat-composer-dock">
            {composer}
          </div>
        )}
      </div>
    );
  },
);
