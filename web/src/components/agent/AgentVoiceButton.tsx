"use client";

import { useLocale } from "@/hooks/useLocale";
import type { AgentVoiceSession } from "@/hooks/useAgentVoiceSession";
import { cn } from "@/lib/utils";
import { Mic, Square } from "lucide-react";

/** Start/stop toggle for the live voice conversation. Lives beside chat input. */
export function AgentVoiceButton({
  voice,
  disabled,
  className,
}: {
  voice: AgentVoiceSession;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const active = voice.active;

  return (
    <button
      type="button"
      aria-label={active ? t("voice.end") : t("voice.start")}
      title={active ? t("voice.end") : t("voice.start")}
      disabled={disabled}
      onClick={() => (active ? void voice.stop() : void voice.start())}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-lg disabled:opacity-50",
        active
          ? "bg-destructive/90 text-destructive-foreground hover:bg-destructive"
          : "bg-muted text-foreground hover:bg-muted/70",
        className,
      )}
    >
      {active ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
    </button>
  );
}
