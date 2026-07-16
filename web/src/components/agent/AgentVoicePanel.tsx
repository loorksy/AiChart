"use client";

import { useEffect, useRef } from "react";
import { Hand, Mic, MicOff, PhoneOff, RotateCcw, Waves } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { AgentVoiceSession } from "@/hooks/useAgentVoiceSession";
import { VoiceStatusIndicator } from "./VoiceStatusIndicator";
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
      className="fixed inset-0 z-[70] flex flex-col items-center justify-between bg-background px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] text-foreground"
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
        <div className="relative flex size-36 items-center justify-center rounded-full border border-primary/30 bg-primary/10 shadow-[0_0_80px_-20px_hsl(var(--primary))]">
          <span className="absolute inset-3 rounded-full border border-primary/20 motion-safe:animate-pulse" />
          {voice.muted ? <MicOff className="h-12 w-12 text-muted-foreground" /> : <Waves className="h-12 w-12 text-primary" />}
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
              className="flex size-12 items-center justify-center rounded-full border border-border bg-card hover:bg-muted"
              aria-label={voice.muted ? t("voice.unmute") : t("voice.mute")}
            >
              {voice.muted ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            {voice.status === "assistant_speaking" ? (
              <button
                type="button"
                onClick={voice.interrupt}
                className="flex min-h-12 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm hover:bg-muted"
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
