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
import { Send } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Button } from "@/components/squareui/button";
import { ComposerIntervalPicker, ComposerSymbolPicker } from "@/components/agent/ComposerMarketPickers";

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
