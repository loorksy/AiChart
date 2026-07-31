"use client";

import { useState, type ReactNode } from "react";
import { Send, Square } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { AgentModelPicker } from "@/components/agent/AgentModelPicker";

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
      data-testid="chat-composer"
      className="chat-composer-shell relative px-3 pt-1 pb-[max(.5rem,env(safe-area-inset-bottom))]"
      dir={dir}
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        setValue("");
        onSend(v);
      }}
    >
      <div className="chat-gpt-input flex items-end gap-1 px-2 py-1">
        <div
          data-switcher-dock="composer"
          data-testid="switcher-composer-dock"
          className="mb-0.5 flex shrink-0 items-center empty:hidden xl:hidden"
        />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("agent.input_placeholder")}
          aria-label={t("agent.input_placeholder")}
          disabled={running}
          className="min-h-9 w-full bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <AgentModelPicker />
        {voiceControl}
        {running ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("agent.cancel")}
            title={t("agent.cancel")}
            className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Square className="h-3 w-3 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label={t("agent.send")}
            title={t("agent.send")}
            className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5 rtl:rotate-180" />
          </button>
        )}
      </div>
    </form>
  );
}
