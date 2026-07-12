"use client";

import { useState } from "react";
import { useLocale } from "@/hooks/useLocale";

export function AgentChatInput({
  running,
  onSend,
  onCancel,
}: {
  running: boolean;
  onSend: (message: string) => void;
  onCancel: () => void;
}) {
  const { t, dir } = useLocale();
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-center gap-2 border-t border-border/60 p-2"
      dir={dir}
      onSubmit={(e) => {
        e.preventDefault();
        const v = value;
        setValue("");
        onSend(v);
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("agent.input_placeholder")}
        disabled={running}
        className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 disabled:opacity-60"
      />
      {running ? (
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-md bg-destructive/90 px-3 py-2 text-xs font-medium text-destructive-foreground hover:bg-destructive"
        >
          {t("agent.stop")}
        </button>
      ) : (
        <button
          type="submit"
          disabled={!value.trim()}
          className="shrink-0 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t("agent.send")}
        </button>
      )}
    </form>
  );
}
