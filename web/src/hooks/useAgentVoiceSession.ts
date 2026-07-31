"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  createVoiceControlController,
  createWebRtcRealtimeTransport,
  defineVoiceTool,
  type RealtimeTransport,
  type VoiceControlController,
  type VoiceControlError,
  type VoiceTool,
} from "realtime-voice-component";
import type { AgentFinalResult } from "@/lib/agent/types";
import type { VoiceErrorCode, VoiceSessionStatus } from "@/lib/agent/voice/types";
import { VoiceConfirmationGuard } from "@/lib/agent/voice/voiceConfirmationGuard";
import { speakableFromResult } from "@/lib/agent/voice/speakableAnswer";
import { voiceBridgeInstructions } from "@/lib/agent/voice/voiceBridgeInstructions";
import { readVoiceLimits } from "@/lib/agent/voice/voiceClientLimits";

const INITIAL_VOICE_OPTIONS = {
  activationMode: "vad" as const,
  outputMode: "text+audio" as const,
  postToolResponse: true,
  auth: {
    sessionEndpoint: "/api/agent/voice/realtime-session",
    sessionRequestInit: { credentials: "include" as RequestCredentials },
  },
  instructions: voiceBridgeInstructions("ar"),
  tools: [] as VoiceTool[],
};

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

type PendingAgent = {
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
};

type MuteableTransport = RealtimeTransport & {
  setMicEnabled?: (enabled: boolean) => void;
};

function mapVoiceError(error: VoiceControlError | undefined): VoiceErrorCode {
  switch (error?.code) {
    case "permission_denied":
      return "mic_permission_denied";
    case "device_unavailable":
      return "mic_unavailable";
    case "unsupported_browser":
    case "insecure_context":
      return "unsupported_browser";
    case "network_error":
    case "media_timeout":
      return "network_lost";
    case "aborted":
      return "unknown";
    default:
      return "webrtc_failed";
  }
}

function mapControllerStatus(input: {
  connected: boolean;
  activity: string;
  status: string;
  muted: boolean;
  awaitingAgent: boolean;
  assistantSpeaking: boolean;
  error: VoiceErrorCode | null;
}): VoiceSessionStatus {
  if (input.error) return "error";
  if (input.status === "connecting" || input.activity === "connecting") return "connecting";
  if (input.assistantSpeaking) return "assistant_speaking";
  if (input.awaitingAgent || input.activity === "executing" || input.activity === "processing") {
    return "processing";
  }
  if (input.connected && (input.status === "listening" || input.activity === "listening")) {
    return "listening";
  }
  if (input.connected) return "connected";
  if (input.status === "idle" || input.activity === "idle") return "idle";
  return "idle";
}

/**
 * Live voice via the official OpenAI realtime-voice-component controller.
 * Realtime is speech I/O only: ask_aichart routes every utterance through the
 * same text agent, then the model speaks the prepared answer.
 */
export function useAgentVoiceSession(opts: UseAgentVoiceSessionOptions) {
  const { sendAgentMessage } = opts;
  const limits = readVoiceLimits();

  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<VoiceErrorCode | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);

  const [controller] = useState<VoiceControlController>(() =>
    createVoiceControlController(INITIAL_VOICE_OPTIONS),
  );
  const transportRef = useRef<MuteableTransport | null>(null);
  const pendingAgentRef = useRef<PendingAgent | null>(null);
  const awaitingAgentRef = useRef(false);
  const guardRef = useRef(new VoiceConfirmationGuard());
  const stoppedRef = useRef(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantSpeakingRef = useRef(false);
  const sendAgentMessageRef = useRef(sendAgentMessage);
  useEffect(() => {
    sendAgentMessageRef.current = sendAgentMessage;
  }, [sendAgentMessage]);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    idleTimerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    clearTimers();
    if (pendingAgentRef.current) {
      pendingAgentRef.current.reject(new Error("voice_stopped"));
      pendingAgentRef.current = null;
    }
    awaitingAgentRef.current = false;
    assistantSpeakingRef.current = false;
    setAssistantSpeaking(false);
    setPartialTranscript("");
    setMuted(false);
    setInterrupted(false);
    setError(null);
    controller.disconnect();
    transportRef.current = null;
    setStatus("stopped");
    // Return to idle so the panel can dismiss after a brief stop flash.
    setTimeout(() => {
      if (stoppedRef.current) setStatus("idle");
    }, 0);
  }, [clearTimers, controller]);

  const armIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      void stop();
    }, limits.idleTimeoutSeconds * 1000);
  }, [limits.idleTimeoutSeconds, stop]);

  const syncFromController = useCallback(() => {
    if (stoppedRef.current) return;
    const snap = controller.getSnapshot();
    setPartialTranscript(snap.transcript || "");
    setStatus(
      mapControllerStatus({
        connected: snap.connected,
        activity: snap.activity,
        status: snap.status,
        muted,
        awaitingAgent: awaitingAgentRef.current,
        assistantSpeaking,
        error,
      }),
    );
    if (snap.connected) armIdleTimer();
  }, [armIdleTimer, assistantSpeaking, controller, error, muted]);

  // Low-latency data lookups: price / account / open trades resolve in about
  // a second through /api/agent/voice/tools, so the conversation stays natural.
  // Anything analytical still routes through ask_aichart → the canonical agent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quickTools = useMemo((): VoiceTool<any>[] => {
    const call = async (name: string, args: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/agent/voice/tools", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, args }),
        });
        return (await res.json()) as Record<string, unknown>;
      } catch {
        return { ok: false, error: "network" };
      }
    };
    return [
      defineVoiceTool({
        name: "get_market_price",
        description:
          "Get the CURRENT live price of a trading symbol (e.g. XAUUSD, EURUSD). Use for quick price questions only.",
        parameters: z.object({
          symbol: z.string().min(3).describe("Trading symbol, e.g. XAUUSD"),
        }),
        execute: ({ symbol }) => call("get_market_price", { symbol }),
      }),
      defineVoiceTool({
        name: "get_account_overview",
        description:
          "Get the connected trading account's balance and equity. Use for quick account questions only.",
        parameters: z.object({}),
        execute: () => call("get_account_overview", {}),
      }),
      defineVoiceTool({
        name: "get_open_trades",
        description:
          "List currently open positions (symbol, side, quantity, entry price). Use for quick position questions only.",
        parameters: z.object({}),
        execute: () => call("get_open_trades", {}),
      }),
    ];
  }, []);

  const askAichartTool = useMemo((): VoiceTool<{ message: string }> => {
    // The refs below are read only when the voice runtime invokes `execute`,
    // never while React renders. The compiler cannot see through defineVoiceTool.
    // eslint-disable-next-line react-hooks/refs
    return defineVoiceTool({
      name: "ask_aichart",
      description:
        "Send the operator's spoken request to AiChart's trading agent and return the public answer to speak aloud.",
      parameters: z.object({
        message: z.string().min(1).describe("The operator's full spoken request."),
      }),
      execute: async ({ message }) => {
        const text = message.trim();
        if (!text) {
          return {
            ok: false,
            answer:
              opts.locale === "en"
                ? "I did not catch that. Please try again."
                : "لم أفهم الطلب. حاول مرة أخرى.",
          };
        }

        awaitingAgentRef.current = true;
        setStatus("processing");
        armIdleTimer();

        try {
          const answer = await new Promise<string>((resolve, reject) => {
            if (pendingAgentRef.current) {
              pendingAgentRef.current.reject(new Error("superseded"));
            }
            const timeout = setTimeout(() => {
              if (pendingAgentRef.current) {
                pendingAgentRef.current = null;
                reject(new Error("agent_timeout"));
              }
            }, 90_000);
            pendingAgentRef.current = {
              resolve: (value) => {
                clearTimeout(timeout);
                pendingAgentRef.current = null;
                resolve(value);
              },
              reject: (err) => {
                clearTimeout(timeout);
                pendingAgentRef.current = null;
                reject(err);
              },
            };
            try {
              sendAgentMessageRef.current(text);
            } catch (err) {
              clearTimeout(timeout);
              pendingAgentRef.current = null;
              reject(err instanceof Error ? err : new Error("send_failed"));
            }
          });
          return { ok: true, answer };
        } catch {
          awaitingAgentRef.current = false;
          return {
            ok: false,
            answer:
              opts.locale === "en"
                ? "I could not complete that request. Please try typing instead."
                : "تعذّر إكمال الطلب. يمكنك الكتابة بدل الصوت.",
          };
        }
      },
    });
  }, [armIdleTimer, opts.locale]);

  useEffect(() => {
    const sessionEndpoint = opts.chatId
      ? `/api/agent/voice/realtime-session?chatId=${encodeURIComponent(opts.chatId)}&locale=${opts.locale}`
      : "/api/agent/voice/realtime-session";

    controller.configure({
      activationMode: "vad",
      outputMode: "text+audio",
      postToolResponse: true,
      auth: {
        sessionEndpoint,
        sessionRequestInit: { credentials: "include" },
      },
      instructions: voiceBridgeInstructions(opts.locale),
      tools: [askAichartTool, ...quickTools],
      model: "gpt-realtime-2.1",
      audio: {
        output: { voice: "alloy" },
        input: {
          transcription: {
            model: "gpt-4o-mini-transcribe",
            language: opts.locale === "ar" ? "ar" : "en",
          },
        },
      },
      transportFactory: () => {
        const transport = createWebRtcRealtimeTransport() as MuteableTransport;
        transportRef.current = transport;
        return transport;
      },
      onError: (voiceError) => {
        if (stoppedRef.current) return;
        const code = mapVoiceError(voiceError);
        setError(code);
        setStatus("error");
        clearTimers();
        controller.disconnect();
      },
      onEvent: (event) => {
        if (stoppedRef.current) return;
        if (!("type" in event) || typeof event.type !== "string") return;
        if (event.type === "input_audio_buffer.speech_started") {
          armIdleTimer();
          if (assistantSpeakingRef.current) {
            assistantSpeakingRef.current = false;
            setAssistantSpeaking(false);
            setInterrupted(true);
            controller.sendClientEvent({ type: "response.cancel" });
          }
        } else if (event.type === "response.output_audio.delta") {
          assistantSpeakingRef.current = true;
          setAssistantSpeaking(true);
          setStatus("assistant_speaking");
        } else if (event.type === "response.done" || event.type === "response.cancelled") {
          assistantSpeakingRef.current = false;
          setAssistantSpeaking(false);
          armIdleTimer();
        } else if (event.type === "voice.tool.started") {
          awaitingAgentRef.current = true;
          setStatus("processing");
        }
      },
    });
  }, [askAichartTool, armIdleTimer, clearTimers, controller, opts.chatId, opts.locale]);

  useEffect(() => {
    return controller.subscribe(() => {
      syncFromController();
    });
  }, [controller, syncFromController]);

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      clearTimers();
      if (pendingAgentRef.current) {
        pendingAgentRef.current.reject(new Error("unmounted"));
        pendingAgentRef.current = null;
      }
      controller.destroy();
      transportRef.current = null;
    };
  }, [clearTimers, controller]);

  const start = useCallback(async () => {
    if (!opts.enabled || !opts.chatId) return;
    stoppedRef.current = false;
    setError(null);
    setMuted(false);
    setInterrupted(false);
    assistantSpeakingRef.current = false;
    setAssistantSpeaking(false);
    setPartialTranscript("");
    setStatus("requesting_permission");
    try {
      setStatus("connecting");
      await controller.connect();
      if (stoppedRef.current) return;
      setStatus("listening");
      armIdleTimer();
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      maxTimerRef.current = setTimeout(() => {
        void stop();
      }, limits.maxMinutes * 60 * 1000);
    } catch (err) {
      const code =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "mic_permission_denied"
          : "webrtc_failed";
      setError(code);
      setStatus("error");
      controller.disconnect();
    }
  }, [opts.enabled, opts.chatId, armIdleTimer, controller, limits.maxMinutes, stop]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    transportRef.current?.setMicEnabled?.(!next);
  }, [muted]);

  const interrupt = useCallback(() => {
    controller.sendClientEvent({ type: "response.cancel" });
    assistantSpeakingRef.current = false;
    setAssistantSpeaking(false);
    setInterrupted(true);
    setStatus("listening");
  }, [controller]);

  /**
   * Called when the agent turn (initiated by voice tool) finalizes.
   * Resolves ask_aichart so the realtime model can speak the answer.
   */
  const handleAgentFinal = useCallback(
    (result: AgentFinalResult) => {
      if (!awaitingAgentRef.current && !pendingAgentRef.current) return;
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
      const speakable =
        speakableFromResult(result) ??
        (opts.locale === "en"
          ? "I finished processing, but there was no spoken answer."
          : "انتهيت من المعالجة لكن لا توجد إجابة صوتية.");
      pendingAgentRef.current?.resolve(speakable);
      pendingAgentRef.current = null;
      armIdleTimer();
    },
    [opts.userId, opts.chatId, opts.locale, armIdleTimer],
  );

  return {
    status,
    muted,
    error,
    interrupted,
    partialTranscript,
    active: status !== "idle" && status !== "stopped" && status !== "error",
    start,
    stop,
    toggleMute,
    interrupt,
    reconnect: start,
    handleAgentFinal,
  };
}

export type AgentVoiceSession = ReturnType<typeof useAgentVoiceSession>;
