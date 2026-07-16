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
      className="flex items-center gap-2 border-t border-border/60 bg-card px-2 pt-2 pb-[max(.5rem,env(safe-area-inset-bottom))]"
      dir={dir}
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        setValue("");
        onSend(v);
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("agent.input_placeholder")}
        aria-label={t("agent.input_placeholder")}
        disabled={running}
        className="min-h-11 w-full rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground outline-none focus:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      {voiceControl}
      {running ? (
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("agent.cancel")}
          title={t("agent.cancel")}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-destructive/90 text-destructive-foreground hover:bg-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Square className="h-4 w-4 fill-current" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!value.trim()}
          aria-label={t("agent.send")}
          title={t("agent.send")}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <Send className="h-4 w-4 rtl:rotate-180" />
        </button>
      )}
    </form>
  );
}
