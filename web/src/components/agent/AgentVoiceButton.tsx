"use client";

import { useLocale } from "@/hooks/useLocale";
import type { AgentVoiceSession } from "@/hooks/useAgentVoiceSession";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/AgentAvatar";
import { voiceStatusToAvatarState } from "@/lib/agent/voice/avatarState";
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
  const liveFace =
    voice.status === "connecting" ||
    voice.status === "listening" ||
    voice.status === "requesting_permission";

  return (
    <button
      type="button"
      aria-label={active ? t("voice.end") : t("voice.start")}
      title={active ? t("voice.end") : t("voice.start")}
      disabled={disabled}
      onClick={() => (active ? void voice.stop() : void voice.start())}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50 sm:size-9",
        active
          ? liveFace
            ? "bg-muted text-foreground ring-1 ring-border"
            : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
          : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {active ? (
        liveFace ? (
          <AgentAvatar
            size={18}
            state={voiceStatusToAvatarState(voice.status)}
          />
        ) : (
          <Square className="h-3.5 w-3.5 fill-current" />
        )
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}
