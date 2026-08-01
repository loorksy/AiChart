"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Send, Square } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { AgentModelPicker } from "@/components/agent/AgentModelPicker";

/** Roughly six lines before the composer starts scrolling its own overflow. */
const MAX_COMPOSER_HEIGHT = 148;

export function AgentChatInput({
  running,
  onSend,
  onCancel,
  voiceControl,
}: {
  running: boolean;
  onSend: (message: string) => void;
  onCancel: () => void;
  voiceControl?: ReactNode;
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
      <div className="chat-gpt-input flex items-end gap-1 px-2 py-1">
        <div
          data-switcher-dock="composer"
          data-testid="switcher-composer-dock"
          className="mb-0.5 flex shrink-0 items-center empty:hidden xl:hidden"
        />
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
          className="max-h-[148px] min-h-11 w-full resize-none bg-transparent px-2 py-2.5 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60 sm:min-h-9 sm:py-2 sm:text-sm"
        />
        <AgentModelPicker />
        {voiceControl}
        {running ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("agent.cancel")}
            title={t("agent.cancel")}
            className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-opacity hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-8"
          >
            <Square className="h-3 w-3 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label={t("agent.send")}
            title={t("agent.send")}
            className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:size-8"
          >
            <Send className="h-4 w-4 rtl:rotate-180 sm:h-3.5 sm:w-3.5" />
          </button>
        )}
      </div>
    </form>
  );
}
