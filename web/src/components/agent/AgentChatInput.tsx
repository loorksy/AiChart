"use client";

import { useState, type ReactNode } from "react";
import { Send, Square } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

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

  return (
    <form
      className="border-t border-border/40 bg-background/30 px-2 pt-2 pb-[max(.5rem,env(safe-area-inset-bottom))]"
      dir={dir}
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        setValue("");
        onSend(v);
      }}
    >
      <div className="chat-gpt-input flex items-center gap-1.5 px-2 py-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("agent.input_placeholder")}
          aria-label={t("agent.input_placeholder")}
          disabled={running}
          className="min-h-10 w-full bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        {voiceControl}
        {running ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("agent.cancel")}
            title={t("agent.cancel")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/90 text-destructive-foreground hover:bg-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label={t("agent.send")}
            title={t("agent.send")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5 rtl:rotate-180" />
          </button>
        )}
      </div>
    </form>
  );
}
