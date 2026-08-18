"use client";

import type { MarketDataSource } from "@/lib/markets/marketDataSource";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowUp, Square } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import { RiskPerTradeControl } from "@/components/agent/RiskPerTradeControl";
import { ComposerIntervalPicker } from "@/components/agent/ComposerMarketPickers";
import {
  ModelChoiceList,
  useAgentModels,
} from "@/components/agent/AgentModelPicker";
import { ProviderIcon } from "@/components/agent/ProviderIcon";
import { ComposerChromeProvider } from "@/components/agent/ComposerChrome";
import { ComposerPopover } from "@/components/agent/ComposerPopover";
import { LiquidMetalFrame } from "@/components/ui/liquid-metal-button";

/** Roughly six lines before the composer starts scrolling its own overflow. */
const MAX_COMPOSER_HEIGHT = 148;

const SPRING = "cubic-bezier(0.175, 0.885, 0.32, 1.275)";

/**
 * The model chip — the user's own model choice, visible in the composer row
 * (Claude-style) instead of buried in the options menu. Real catalogue only:
 * the list is /api/agent/models (curated trios + live free OpenRouter routes)
 * and the pick persists to the user's settings.
 */
function ComposerModelChip() {
  const [open, setOpen] = useState(false);
  const { data, saving, choose, activeLabel, available } = useAgentModels(true);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  if (!available || !data) return null;

  const activeRef = data.selected ?? data.platformDefault;
  const provider = activeRef?.split("/")[0] ?? "openai";

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={activeLabel ?? "model"}
        className={cn("metal-chip max-w-40", open && "text-foreground")}
      >
        <ProviderIcon provider={provider} size={13} className="shrink-0 opacity-80" />
        <span className="truncate text-xs font-medium" dir="ltr">
          {activeLabel}
        </span>
      </button>

      <ComposerPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        title={activeLabel ?? "model"}
        testId="composer-model-menu"
      >
        <ModelChoiceList
          models={data.models}
          selected={data.selected}
          saving={saving}
          onChoose={(ref) => {
            void choose(ref);
            setOpen(false);
          }}
        />
      </ComposerPopover>
    </div>
  );
}

export function AgentChatInput({
  running,
  onSend,
  onCancel,
  symbol,
  interval,
  onSymbolChange,
  onIntervalChange,
}: {
  running: boolean;
  onSend: (message: string) => void;
  onCancel: () => void;
  /** Market context row: the pair and frame the next question is about. */
  symbol?: string;
  interval?: string;
  onSymbolChange?: (symbol: string, source: MarketDataSource) => void;
  onIntervalChange?: (interval: string) => void;
}) {
  const { t, dir } = useLocale();
  const [value, setValue] = useState("");
  const [launching, setLaunching] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const shellRef = useRef<HTMLFormElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

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
    setLaunching(true);
    window.setTimeout(() => setLaunching(false), 450);
    setValue("");
    onSend(v);
  }, [value, running, onSend]);

  const canSend = Boolean(value.trim()) && !running;

  return (
    <form
      ref={shellRef}
      data-testid="chat-composer"
      className="chat-composer-shell relative overflow-visible px-3 pt-1 pb-[max(.5rem,env(safe-area-inset-bottom))]"
      dir={dir}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ComposerChromeProvider value={{ hostRef: frameRef, rootRef: shellRef }}>
      {/*
        Two tiers, not one row: the text gets the full width to grow into, and
        the controls sit on their own line underneath. Crowding a model picker,
        a chart toggle and a send button into the same line as the caret left
        the message itself the narrowest thing in the composer.
      */}
      <LiquidMetalFrame ref={frameRef} className="chat-gpt-input mx-auto w-full max-w-3xl">
        <div className="flex flex-col px-4 pb-4 pt-5">
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
          className="mb-4 max-h-[148px] min-h-4 w-full resize-none bg-transparent p-0 text-sm leading-4 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />

        <div className="composer-chip-row">
          {/*
            One row for what governs the next turn: which model answers and
            which timeframe is up. There is no instrument picker — the
            platform analyses gold and only gold.
          */}
          <ComposerModelChip />
          {interval && onIntervalChange && (
            <ComposerIntervalPicker interval={interval} onSelect={onIntervalChange} />
          )}
          <RiskPerTradeControl />

          {/*
            End of the row: ONE morphing action slot — the send arrow and the
            stop square crossfade in place (rotate + scale) instead of
            swapping DOM, so the button never jumps under the pointer.
            Same chip chrome as the model / risk controls.
          */}
          <div className="ms-auto flex items-center">
            <button
              type={running ? "button" : "submit"}
              onClick={running ? onCancel : undefined}
              disabled={!running && !canSend}
              aria-label={running ? t("agent.cancel") : t("agent.send")}
              title={running ? t("agent.cancel") : t("agent.send")}
              className={cn(
                "metal-chip metal-chip-icon group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                running && "text-destructive",
                !running && canSend && "composer-send-ready",
                !running && !canSend && "opacity-40",
              )}
            >
              <span
                className={cn(
                  "absolute inset-0 flex items-center justify-center transition-all duration-300",
                  running
                    ? "pointer-events-none rotate-45 scale-50 opacity-0 blur-[1px]"
                    : "rotate-0 scale-100 opacity-100 blur-none",
                  launching && !running && "composer-send-launch",
                )}
                style={{ transitionTimingFunction: SPRING }}
                aria-hidden
              >
                <ArrowUp
                  className="composer-send-glyph size-4"
                  strokeWidth={2.25}
                />
              </span>
              <span
                className={cn(
                  "absolute inset-0 flex items-center justify-center transition-all duration-300",
                  running
                    ? "rotate-0 scale-100 opacity-100 blur-none"
                    : "pointer-events-none -rotate-45 scale-50 opacity-0 blur-[1px]",
                )}
                style={{ transitionTimingFunction: SPRING }}
                aria-hidden
              >
                <Square className="h-3 w-3 fill-current" />
              </span>
            </button>
          </div>
        </div>
        </div>
      </LiquidMetalFrame>
      </ComposerChromeProvider>
    </form>
  );
}
