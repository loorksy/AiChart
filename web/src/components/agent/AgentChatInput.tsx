"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CandlestickChart, Send, Square } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { AgentModelPicker } from "@/components/agent/AgentModelPicker";
import { RiskPerTradeControl } from "@/components/agent/RiskPerTradeControl";
import {
  ComposerIntervalPicker,
  ComposerSymbolPicker,
} from "@/components/agent/ComposerMarketPickers";
import { cn } from "@/lib/utils";

/** Roughly six lines before the composer starts scrolling its own overflow. */
const MAX_COMPOSER_HEIGHT = 148;

const ACTION_BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9";

export function AgentChatInput({
  running,
  onSend,
  onCancel,
  voiceControl,
  chartOpen,
  onToggleChart,
  symbol,
  interval,
  brokerConnected = false,
  onSymbolChange,
  onIntervalChange,
}: {
  running: boolean;
  onSend: (message: string) => void;
  onCancel: () => void;
  voiceControl?: ReactNode;
  /** Whether the chart surface is currently showing, for the toggle's state. */
  chartOpen?: boolean;
  /** Absent when there is no chart to summon (guest / capture renders). */
  onToggleChart?: () => void;
  /** Market context row: the pair and frame the next question is about. */
  symbol?: string;
  interval?: string;
  brokerConnected?: boolean;
  onSymbolChange?: (symbol: string, source: "oanda" | "ea") => void;
  onIntervalChange?: (interval: string) => void;
}) {
  const { t, dir } = useLocale();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
            One row for what governs the next turn: which chart is up, how much
            of the account is at stake, and which model answers. All three used
            to live somewhere else — a floating switcher, a settings section, and
            a differently-shaped dropdown.
          */}
          {onToggleChart && (
            <button
              type="button"
              onClick={onToggleChart}
              aria-pressed={chartOpen}
              aria-label={chartOpen ? t("layout.close_chart") : t("layout.show_chart")}
              title={chartOpen ? t("layout.close_chart") : t("layout.show_chart")}
              data-testid="composer-chart-toggle"
              className={cn(
                ACTION_BUTTON,
                // A toggle, so its on-state is permanent rather than a hover.
                chartOpen && "bg-muted text-foreground",
              )}
            >
              <CandlestickChart className="h-5 w-5 sm:h-4 sm:w-4" />
            </button>
          )}
          {symbol && onSymbolChange && (
            <ComposerSymbolPicker
              symbol={symbol}
              brokerConnected={brokerConnected}
              onSelect={onSymbolChange}
            />
          )}
          {interval && onIntervalChange && (
            <ComposerIntervalPicker interval={interval} onSelect={onIntervalChange} />
          )}
          <RiskPerTradeControl />
          <AgentModelPicker />

          {/* Logical end of the row: mirrors under dir="rtl" with no branch. */}
          <div className="ms-auto flex items-center gap-1">
            {voiceControl}
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
            ) : (
              <button
                type="submit"
                disabled={!value.trim()}
                aria-label={t("agent.send")}
                title={t("agent.send")}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:size-9"
              >
                <Send className="h-4 w-4 rtl:rotate-180" />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
