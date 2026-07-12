"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { AgentFinalResult } from "@/lib/agent/types";
import type {
  VoiceProviderEvent,
  VoiceProviderSession,
  VoiceSessionCredential,
  VoiceErrorCode,
} from "@/lib/agent/voice/types";
import { isRecoverableVoiceError } from "@/lib/agent/voice/types";
import {
  voiceSessionReducer,
  initialVoiceState,
} from "@/lib/agent/voice/voiceSessionReducer";
import { TranscriptTracker } from "@/lib/agent/voice/transcriptTracker";
import { VoiceConfirmationGuard } from "@/lib/agent/voice/voiceConfirmationGuard";
import { speakableFromResult } from "@/lib/agent/voice/speakableAnswer";
import { createOpenAIRealtimeProvider } from "@/lib/agent/voice/openaiRealtimeProvider";

export interface UseAgentVoiceSessionOptions {
  chatId?: string;
  locale: "ar" | "en";
  symbol: string;
  interval: string;
  userId: number;
  enabled?: boolean;
  /** Send a finalized voice transcript through the SAME agent flow as text. */
  sendAgentMessage: (text: string) => void;
}

const DEFAULT_MAX_RECONNECT = 3;

/**
 * Drives a real-time WebRTC voice conversation with Lonora. The realtime model
 * is only the speech interface: every final user transcript is routed through
 * the existing text-agent flow (`sendAgentMessage`), and the agent's final
 * public answer is spoken back via `handleAgentFinal`. Fully cleans up mic,
 * peer connection, data channel, timers, and reconnects on stop/unmount.
 */
export function useAgentVoiceSession(opts: UseAgentVoiceSessionOptions) {
  const { sendAgentMessage } = opts;
  const [state, dispatch] = useReducer(
    voiceSessionReducer,
    DEFAULT_MAX_RECONNECT,
    initialVoiceState,
  );
  const [partialTranscript, setPartialTranscript] = useState("");

  const providerRef = useRef<VoiceProviderSession | null>(null);
  const credentialRef = useRef<VoiceSessionCredential | null>(null);
  const trackerRef = useRef(new TranscriptTracker());
  const guardRef = useRef(new VoiceConfirmationGuard());
  const awaitingAgentRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  // Refs break the mutual recursion between event handling, reconnect, and
  // connect (each references the next) without stale-closure lint violations.
  const handleProviderEventRef = useRef<(event: VoiceProviderEvent) => void>(() => {});
  const handleErrorRef = useRef<(code: VoiceErrorCode) => void>(() => {});

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    idleTimerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  const teardownProvider = useCallback(async () => {
    const provider = providerRef.current;
    providerRef.current = null;
    if (provider) {
      try {
        await provider.stop();
      } catch {
        /* already gone */
      }
    }
  }, []);

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    dispatch({ type: "stop" });
    clearTimers();
    await teardownProvider();
    trackerRef.current.reset();
    guardRef.current.reset();
    awaitingAgentRef.current = false;
    setPartialTranscript("");
    dispatch({ type: "stopped" });
  }, [clearTimers, teardownProvider]);

  const armIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    const seconds = credentialRef.current?.limits.idleTimeoutSeconds ?? 45;
    idleTimerRef.current = setTimeout(() => {
      void stop();
    }, seconds * 1000);
  }, [stop]);

  const handleProviderEvent = useCallback(
    (event: VoiceProviderEvent) => {
      if (stoppedRef.current) return;
      switch (event.kind) {
        case "status":
          if (event.status === "listening") armIdleTimer();
          dispatch({
            type:
              event.status === "connecting"
                ? "connecting"
                : event.status === "connected"
                  ? "connected"
                  : event.status === "listening"
                    ? "listening"
                    : "connected",
          });
          break;
        case "user_speech_started":
          armIdleTimer();
          // Barge-in: if the assistant is speaking, cut it off and keep listening.
          if (providerRef.current) providerRef.current.interrupt();
          dispatch({ type: "interrupt" });
          dispatch({ type: "user_speech_started" });
          break;
        case "user_speech_stopped":
          dispatch({ type: "user_speech_stopped" });
          break;
        case "transcript": {
          const outcome = trackerRef.current.handle(event.transcript);
          if (event.transcript.role === "user" && outcome.display !== undefined) {
            setPartialTranscript(outcome.display);
          }
          if (outcome.submit) {
            setPartialTranscript("");
            armIdleTimer();
            awaitingAgentRef.current = true;
            dispatch({ type: "processing" });
            // Route the final transcript through the SAME agent flow as text.
            sendAgentMessage(outcome.submit);
          }
          break;
        }
        case "assistant_audio_started":
          dispatch({ type: "assistant_speaking" });
          break;
        case "assistant_audio_stopped":
          dispatch({ type: "assistant_stopped" });
          armIdleTimer();
          break;
        case "error":
          handleErrorRef.current(event.code);
          break;
      }
    },
    [armIdleTimer, sendAgentMessage],
  );

  const mintCredential = useCallback(async (): Promise<VoiceSessionCredential> => {
    const res = await fetch("/api/agent/voice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: opts.chatId,
        locale: opts.locale,
        symbol: opts.symbol,
        interval: opts.interval,
      }),
    });
    if (!res.ok) {
      const code: VoiceErrorCode = res.status === 429 ? "provider_unavailable" : "credential_failed";
      throw Object.assign(new Error("credential"), { code });
    }
    return (await res.json()) as VoiceSessionCredential;
  }, [opts.chatId, opts.locale, opts.symbol, opts.interval]);

  const connect = useCallback(async () => {
    const credential = await mintCredential();
    credentialRef.current = credential;
    const provider = createOpenAIRealtimeProvider({
      credential,
      locale: opts.locale,
      onEvent: (event) => handleProviderEventRef.current(event),
    });
    providerRef.current = provider;
    await provider.start();
    // Hard cap on total session duration (cost guard).
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    maxTimerRef.current = setTimeout(
      () => void stop(),
      credential.limits.maxMinutes * 60 * 1000,
    );
  }, [mintCredential, opts.locale, stop]);

  const handleError = useCallback(
    (code: VoiceErrorCode) => {
      if (stoppedRef.current) return;
      if (isRecoverableVoiceError(code) && state.reconnectAttempts < state.maxReconnectAttempts) {
        dispatch({ type: "disconnected", recoverable: true });
        void teardownProvider().then(async () => {
          if (stoppedRef.current) return;
          try {
            await connect();
            dispatch({ type: "reconnected" });
          } catch {
            dispatch({ type: "error", code: "credential_failed" });
          }
        });
      } else {
        dispatch({ type: "error", code });
        clearTimers();
        void teardownProvider();
      }
    },
    [state.reconnectAttempts, state.maxReconnectAttempts, connect, teardownProvider, clearTimers],
  );

  // Keep the indirection refs pointing at the latest callbacks (updated in an
  // effect, never during render).
  useEffect(() => {
    handleProviderEventRef.current = handleProviderEvent;
    handleErrorRef.current = handleError;
  }, [handleProviderEvent, handleError]);

  const start = useCallback(async () => {
    if (!opts.enabled || !opts.chatId) return;
    stoppedRef.current = false;
    trackerRef.current.reset();
    dispatch({ type: "request_permission" });
    try {
      await connect();
    } catch (err) {
      const code =
        (err as { code?: VoiceErrorCode }).code ??
        (err instanceof DOMException && err.name === "NotAllowedError"
          ? "mic_permission_denied"
          : "unknown");
      dispatch({ type: "error", code: code as VoiceErrorCode });
      await teardownProvider();
    }
  }, [opts.enabled, opts.chatId, connect, teardownProvider]);

  const toggleMute = useCallback(() => {
    const provider = providerRef.current;
    if (!provider) return;
    if (state.muted) {
      provider.unmute();
      dispatch({ type: "unmute" });
    } else {
      provider.mute();
      dispatch({ type: "mute" });
    }
  }, [state.muted]);

  const interrupt = useCallback(() => {
    providerRef.current?.interrupt();
    dispatch({ type: "interrupt" });
  }, []);

  /**
   * Called by the workspace when the agent turn (initiated by voice) finalizes.
   * Speaks ONLY the public final answer — never activity, debug, or reasoning —
   * and arms the confirmation guard if the agent requested confirmation.
   */
  const handleAgentFinal = useCallback(
    (result: AgentFinalResult) => {
      if (!awaitingAgentRef.current) return; // a typed turn — don't speak it
      awaitingAgentRef.current = false;
      if (result.requiresConfirmation && opts.chatId) {
        const p = result.confirmationPayload;
        guardRef.current.arm({
          userId: opts.userId,
          chatId: opts.chatId,
          action: p ? `${p.direction} ${p.symbol}` : "execution",
          now: Date.now(),
        });
      }
      const speakable = speakableFromResult(result);
      if (speakable) {
        dispatch({ type: "assistant_speaking" });
        void providerRef.current?.speakText(speakable);
      } else {
        dispatch({ type: "assistant_stopped" });
      }
      armIdleTimer();
    },
    [opts.userId, opts.chatId, armIdleTimer],
  );

  // Stop cleanly on unmount and when the bound chat changes (rebind safely).
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      clearTimers();
      void teardownProvider();
    };
  }, [clearTimers, teardownProvider]);

  // Pause a background session that stays hidden too long (cost guard).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onHidden = () => {
      if (document.visibilityState === "hidden" && state.status !== "idle" && state.status !== "stopped") {
        // Give the tab a grace period; if still hidden, the idle timer stops it.
        armIdleTimer();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [state.status, armIdleTimer]);

  return {
    status: state.status,
    muted: state.muted,
    error: state.error,
    interrupted: state.interrupted,
    partialTranscript,
    active: state.status !== "idle" && state.status !== "stopped" && state.status !== "error",
    start,
    stop,
    toggleMute,
    interrupt,
    reconnect: start,
    handleAgentFinal,
  };
}

export type AgentVoiceSession = ReturnType<typeof useAgentVoiceSession>;
