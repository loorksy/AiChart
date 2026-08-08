"use client";

/**
 * Memory-save affordance (plan §4/§6) — an inline action row under an
 * assistant message when the turn's response includes a memory candidate.
 * `draftMemoryCandidate` only ever suggests; this banner's "Remember this"
 * button is the sole trigger for the confirm endpoint that actually writes.
 */
import { useState } from "react";
import { BookmarkPlus, Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Button } from "@/components/squareui/button";

export interface QuantAgentMemorySaveBannerProps {
  content: string;
  chatId?: string;
}

export function QuantAgentMemorySaveBanner({ content, chatId }: QuantAgentMemorySaveBannerProps) {
  const { t, dir, locale } = useLocale();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  if (status === "saved") {
    return (
      <div dir={dir} className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-buy">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        {t("qa.chat.memory.saved")}
      </div>
    );
  }

  async function handleConfirm() {
    setStatus("saving");
    try {
      const res = await fetch("/api/quant-agent/chat/memory/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, chatId, locale }),
      });
      if (!res.ok) throw new Error("confirm failed");
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div dir={dir} className="mt-1.5 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={status === "saving"} onClick={() => void handleConfirm()}>
        <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
        {status === "saving" ? t("qa.chat.memory.saving") : t("qa.chat.memory.remember_cta")}
      </Button>
      {status === "error" ? (
        <span className="text-[12px] text-destructive">{t("qa.chat.memory.error")}</span>
      ) : null}
    </div>
  );
}
