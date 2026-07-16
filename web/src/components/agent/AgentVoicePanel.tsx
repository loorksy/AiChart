"use client";

import { useEffect, useRef } from "react";
import { Hand, Mic, MicOff, PhoneOff, RotateCcw } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { AgentVoiceSession } from "@/hooks/useAgentVoiceSession";
import { AgentAvatar } from "@/components/AgentAvatar";
import { VoiceStatusIndicator } from "./VoiceStatusIndicator";
import { voiceStatusToAvatarState } from "@/lib/agent/voice/avatarState";
import { voiceErrorKey } from "@/lib/agent/voice/voiceLabels";

/** Immersive voice mode: one focused conversation surface, then back to chat. */
export function AgentVoicePanel({ voice }: { voice: AgentVoiceSession }) {
  const { t, dir } = useLocale();
  const dialogRef = useRef<HTMLElement | null>(null);
  const { active, status, stop } = voice;

  useEffect(() => {
    if (!active && status !== "error") return;
    const dialog = dialogRef.current;
    const selector = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(selector) ?? []);
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void stop();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, status, stop]);

  if (!voice.active && voice.status !== "error") return null;

  return (
    <section
      ref={dialogRef}
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-label={t("voice.start")}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-between bg-background/95 px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] text-foreground backdrop-blur-sm"
    >
      <div className="flex w-full max-w-xl items-center justify-between">
        <VoiceStatusIndicator status={voice.status} muted={voice.muted} />
        <button
          type="button"
          onClick={() => void voice.stop()}
          className="flex min-h-11 items-center gap-2 rounded-full border border-destructive/40 px-4 text-sm text-destructive hover:bg-destructive/10"
        >
          <PhoneOff className="h-4 w-4" />
          {t("voice.end")}
        </button>
      </div>

      <div className="flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-7 text-center">
        <div className="relative flex size-36 items-center justify-center rounded-full border border-primary/25 bg-[var(--glass-bg)] shadow-[0_0_80px_-24px_color-mix(in_srgb,var(--primary)_55%,transparent)] backdrop-blur-sm">
          {(voice.status === "connecting" ||
            voice.status === "listening" ||
            voice.status === "assistant_speaking") && (
            <span className="absolute inset-3 rounded-full border border-primary/20 motion-safe:animate-pulse-soft" />
          )}
          {voice.muted ? (
            <MicOff className="h-12 w-12 text-muted-foreground" />
          ) : (
            <AgentAvatar
              size={64}
              state={voiceStatusToAvatarState(voice.status)}
            />
          )}
        </div>
        {voice.partialTranscript ? (
          <p className="max-h-40 overflow-y-auto text-balance text-xl leading-relaxed">
            {voice.partialTranscript}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("voice.start")}</p>
        )}
        {voice.status === "error" && voice.error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t(voiceErrorKey(voice.error))}
          </p>
        ) : null}
      </div>

      <div className="flex w-full max-w-xl items-center justify-center gap-3">
        {voice.status === "error" ? (
          <button
            type="button"
            onClick={() => void voice.reconnect()}
            className="flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 font-semibold text-primary-foreground"
          >
            <RotateCcw className="h-5 w-5" />
            {t("voice.reconnect")}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={voice.toggleMute}
              className="flex size-12 items-center justify-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-sm hover:border-primary/40 hover:bg-primary/5"
              aria-label={voice.muted ? t("voice.unmute") : t("voice.mute")}
            >
              {voice.muted ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            {voice.status === "assistant_speaking" ? (
              <button
                type="button"
                onClick={voice.interrupt}
                className="flex min-h-12 items-center gap-2 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] px-5 text-sm backdrop-blur-sm hover:border-primary/40 hover:bg-primary/5"
              >
                <Hand className="h-5 w-5" />
                {t("voice.interrupt")}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
