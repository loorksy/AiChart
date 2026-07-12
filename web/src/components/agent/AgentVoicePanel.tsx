"use client";

import { useLocale } from "@/hooks/useLocale";
import type { AgentVoiceSession } from "@/hooks/useAgentVoiceSession";
import { VoiceStatusIndicator } from "./VoiceStatusIndicator";
import { voiceErrorKey } from "@/lib/agent/voice/voiceLabels";

/**
 * The live voice conversation surface: status, current partial transcript,
 * and controls (mute / interrupt / reconnect / end). Rendered only while a
 * session is active, so it never covers the chat input or Chart/Chat tabs when
 * voice is off. Desktop: inside the chat area; mobile: a compact full-width bar.
 */
export function AgentVoicePanel({ voice }: { voice: AgentVoiceSession }) {
  const { t, dir } = useLocale();
  if (!voice.active && voice.status !== "error") return null;

  const showInterrupt = voice.status === "assistant_speaking";

  return (
    <div
      dir={dir}
      className="shrink-0 border-t border-border/60 bg-background/80 px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <VoiceStatusIndicator status={voice.status} muted={voice.muted} />
        <div className="flex items-center gap-1.5">
          {voice.status === "error" ? (
            <button
              type="button"
              onClick={() => void voice.reconnect()}
              className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {t("voice.reconnect")}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={voice.toggleMute}
                className="rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] hover:bg-muted"
              >
                {voice.muted ? t("voice.unmute") : t("voice.mute")}
              </button>
              {showInterrupt && (
                <button
                  type="button"
                  onClick={voice.interrupt}
                  className="rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] hover:bg-muted"
                >
                  {t("voice.interrupt")}
                </button>
              )}
              <button
                type="button"
                onClick={() => void voice.stop()}
                className="rounded-md bg-destructive/90 px-2 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive"
              >
                {t("voice.end")}
              </button>
            </>
          )}
        </div>
      </div>

      {voice.partialTranscript ? (
        <p className="mt-1 truncate text-[12px] text-muted-foreground">
          {t("voice.you_said")}: {voice.partialTranscript}
        </p>
      ) : null}

      {voice.status === "error" && voice.error ? (
        <p className="mt-1 text-[12px] text-destructive-foreground">
          {t(voiceErrorKey(voice.error))}
        </p>
      ) : null}
    </div>
  );
}
