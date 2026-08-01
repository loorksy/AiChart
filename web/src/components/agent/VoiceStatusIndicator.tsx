"use client";

import { useLocale } from "@/hooks/useLocale";
import { voiceStatusKey } from "@/lib/agent/voice/voiceLabels";
import type { VoiceSessionStatus } from "@/lib/agent/voice/types";
import { cn } from "@/lib/utils";

/** A small live status pill reflecting the real session state (not fake). */
export function VoiceStatusIndicator({
  status,
  muted,
}: {
  status: VoiceSessionStatus;
  muted: boolean;
}) {
  const { t } = useLocale();
  const label = muted && status === "listening" ? t("voice.muted") : t(voiceStatusKey(status));

  const dotClass =
    status === "user_speaking"
      ? "bg-success animate-pulse motion-reduce:animate-none"
      : status === "assistant_speaking"
        ? "bg-primary animate-pulse motion-reduce:animate-none"
        : status === "processing"
          ? "bg-warning animate-pulse motion-reduce:animate-none"
          : status === "reconnecting"
            ? "bg-warning animate-pulse motion-reduce:animate-none"
            : status === "error"
              ? "bg-destructive"
              : status === "listening"
                ? "bg-success"
                : "bg-muted-foreground";

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass)} />
      <span>{label}</span>
    </div>
  );
}
