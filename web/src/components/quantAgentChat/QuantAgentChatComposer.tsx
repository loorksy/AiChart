"use client";

/**
 * Composer for Quant Agent Chat (plan §4) — a symbol picker row above a text
 * input + send button. No file/image attachments in v1 (out of scope).
 *
 * The symbol picker (Gap 1) reuses `ComposerSymbolPicker` verbatim — the
 * exact same trigger + `SymbolPickerSheet` mechanism Lonora's own
 * `AgentChatInput.tsx` wires up — rather than building a new picker. Symbol
 * state itself is lifted one level up into `QuantAgentChatPanel`, following
 * the same prop-drilling pattern `AgentChatInput.tsx` uses for Lonora.
 *
 * The draft text is a CONTROLLED value (Feature B / Composer Coach): it used
 * to be local `useState`, now lifted into `QuantAgentChatPanel` so a
 * Composer Coach suggestion chip click can populate it from outside.
 */
import type { MarketDataSource } from "@/lib/markets/marketDataSource";
import { type KeyboardEvent } from "react";
import { LayoutGrid, Send } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Button } from "@/components/squareui/button";
import { ComposerIntervalPicker, ComposerSymbolPicker } from "@/components/agent/ComposerMarketPickers";

/**
 * Same trigger grammar as the symbol/interval pickers next to it
 * (`ComposerMarketPickers`' own `TRIGGER_CLASS`), so the composer's top row
 * reads as one control strip rather than three unrelated buttons.
 */
const QUICK_TOOLS_TRIGGER_CLASS =
  "flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9";

export interface QuantAgentChatComposerProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  /** The pair the next question/analysis is scoped to. */
  symbol: string;
  /**
   * The timeframe the next backtest (plan §4/§5) is scoped to — new capability,
   * the chat had no interval concept before this. Reuses `ComposerIntervalPicker`
   * verbatim, the exact same trigger + popover Lonora's own `AgentChatInput.tsx`
   * wires up, rather than building a new picker.
   */
  interval: string;
  /**
   * Quant Agent never touches broker accounts — this only governs whether
   * the symbol picker sheet shows live quotes, never correctness. Pass the
   * real broker-link state when one is cheaply available; `false` otherwise.
   */
  brokerConnected: boolean;
  onSymbolChange: (symbol: string, source: MarketDataSource) => void;
  onIntervalChange: (interval: string) => void;
  /** Controlled draft text — lifted so `QuantAgentComposerCoach` chips can set it. */
  value: string;
  onValueChange: (value: string) => void;
  /**
   * Opens the "Quick tools" sheet. Omitted — and the trigger hidden — while the
   * conversation is still empty, because the welcome screen is already showing
   * the same eight tools full-size (upstream gates its own button the same way:
   * `v-if="messages.length"`).
   */
  onOpenQuickTools?: () => void;
}

export function QuantAgentChatComposer({
  onSend,
  disabled,
  symbol,
  interval,
  brokerConnected,
  onSymbolChange,
  onIntervalChange,
  value,
  onValueChange,
  onOpenQuickTools,
}: QuantAgentChatComposerProps) {
  const { t, dir } = useLocale();

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    onValueChange("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div dir={dir} className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-2">
      <div className="flex items-center gap-1">
        <ComposerSymbolPicker symbol={symbol} brokerConnected={brokerConnected} onSelect={onSymbolChange} />
        <ComposerIntervalPicker interval={interval} onSelect={onIntervalChange} />
        {onOpenQuickTools ? (
          <button
            type="button"
            onClick={onOpenQuickTools}
            disabled={disabled}
            aria-label={t("qa.quicktool.title")}
            title={t("qa.quicktool.title")}
            data-testid="quant-agent-quick-tools-trigger"
            className={QUICK_TOOLS_TRIGGER_CLASS}
          >
            <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {/* The label is the first thing to go on a 360px screen — the icon
                and its accessible name carry the control on their own. */}
            <span className="hidden sm:inline">{t("qa.quicktool.title")}</span>
          </button>
        ) : null}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={t("qa.chat.composer.placeholder")}
          aria-label={t("qa.chat.composer.placeholder")}
          className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <Button
          type="button"
          size="icon-lg"
          disabled={disabled || !value.trim()}
          onClick={submit}
          aria-label={t("qa.chat.composer.send")}
        >
          <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
