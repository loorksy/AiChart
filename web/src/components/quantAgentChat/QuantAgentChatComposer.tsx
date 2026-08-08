"use client";

/**
 * Composer for Quant Agent Chat (plan §4) — text input + send button only.
 * No file/image attachments in v1 (out of scope).
 */
import { useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Button } from "@/components/squareui/button";

export interface QuantAgentChatComposerProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function QuantAgentChatComposer({ onSend, disabled }: QuantAgentChatComposerProps) {
  const { t, dir } = useLocale();
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div
      dir={dir}
      className="flex items-end gap-2 rounded-xl border border-border bg-card p-2"
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
  );
}
