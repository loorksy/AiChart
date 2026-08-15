"use client";

import type { MarketDataSource } from "@/lib/markets/marketDataSource";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Send, Square } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useTradeMode } from "@/hooks/useTradeMode";
import { ComposerMoreMenu } from "@/components/agent/ComposerMoreMenu";
import { RiskPerTradeControl } from "@/components/agent/RiskPerTradeControl";
import { ComposerIntervalPicker } from "@/components/agent/ComposerMarketPickers";

/** Roughly six lines before the composer starts scrolling its own overflow. */
const MAX_COMPOSER_HEIGHT = 148;

export function AgentChatInput({
  running,
  onSend,
  onCancel,
  voiceControl,
  symbol,
  interval,
  brokerConnected = false,
  onSymbolChange,
  onIntervalChange,
}: {
  running: boolean;
  onSend: (message: string) => void;
  onCancel: () => void;
  /** Rendered in the adaptive end slot while the box is empty. */
  voiceControl?: ReactNode;
  /** Market context row: the pair and frame the next question is about. */
  symbol?: string;
  interval?: string;
  brokerConnected?: boolean;
  onSymbolChange?: (symbol: string, source: MarketDataSource) => void;
  onIntervalChange?: (interval: string) => void;
}) {
  const { t, dir } = useLocale();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Context chip (Phase 3.2): whether execution is armed is part of what
  // governs the next turn, so it sits visibly in the row — read-only here;
  // changing it stays behind the options menu's explicit confirmation flow.
  const { view: tradeMode } = useTradeMode({ enabled: brokerConnected });
  const visibleMode =
    brokerConnected && tradeMode?.connected && tradeMode.mode !== "unset"
      ? tradeMode.mode
      : null;

  // Auto-grow: reset to auto first so the box can also shrink back down.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [value]);

  const submit = useCallback(() => {
    const v = value.trim();
    if (!v || running) return;
    setValue("");
    onSend(v);
  }, [value, running, onSend]);

  return (
    <form
      data-testid="chat-composer"
      className="chat-composer-shell relative px-3 pt-1 pb-[max(.5rem,env(safe-area-inset-bottom))]"
      dir={dir}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/*
        Two tiers, not one row: the text gets the full width to grow into, and
        the controls sit on their own line underneath. Crowding a model picker, a
        mic, a chart toggle and a send button into the same line as the caret
        left the message itself the narrowest thing in the composer.
      */}
      <div className="chat-gpt-input flex flex-col gap-1 px-2 py-1.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line. isComposing guards the
            // Arabic/predictive IME, where Enter commits a candidate instead.
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            submit();
          }}
          rows={1}
          placeholder={t("agent.input_placeholder")}
          aria-label={t("agent.input_placeholder")}
          disabled={running}
          className="max-h-[148px] min-h-9 w-full resize-none bg-transparent px-1 py-1.5 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60 sm:text-sm"
        />

        <div className="flex items-center gap-1">
          {/*
            One row for what governs the next turn: which timeframe is up and
            which model answers. There is no instrument picker — the platform
            analyses gold and only gold.
          */}
          {interval && onIntervalChange && (
            <ComposerIntervalPicker interval={interval} onSelect={onIntervalChange} />
          )}
          <RiskPerTradeControl />
          {visibleMode ? (
            <span
              data-testid="composer-mode-chip"
              title={t(`trade_mode.desc.${visibleMode}`)}
              className={
                visibleMode === "auto"
                  ? "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 text-[11px] font-medium text-warning"
                  : "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 text-[11px] text-muted-foreground"
              }
            >
              <span
                className={
                  visibleMode === "auto"
                    ? "h-1.5 w-1.5 rounded-full bg-warning"
                    : "h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
                }
                aria-hidden
              />
              {t(`trade_mode.mode.${visibleMode}`)}
            </span>
          ) : null}

          {/*
            End of the row: the plus holds what is set once and left alone (the
            model, the execution mode), and beside it ONE adaptive slot —
            generating → stop, text typed → send, empty → the mic. The voice
            control stops being a permanent icon fighting the pickers for width
            on a 390px row; it appears exactly when it is the action.
          */}
          <div className="ms-auto flex items-center gap-0.5">
            <ComposerMoreMenu />
            {running ? (
              <button
                type="button"
                onClick={onCancel}
                aria-label={t("agent.cancel")}
                title={t("agent.cancel")}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-colors duration-150 hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9"
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            ) : value.trim() ? (
              <button
                type="submit"
                aria-label={t("agent.send")}
                title={t("agent.send")}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9"
              >
                <Send className="h-4 w-4 rtl:rotate-180" />
              </button>
            ) : (
              voiceControl ?? (
                <button
                  type="submit"
                  disabled
                  aria-label={t("agent.send")}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background opacity-40 sm:size-9"
                >
                  <Send className="h-4 w-4 rtl:rotate-180" />
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
