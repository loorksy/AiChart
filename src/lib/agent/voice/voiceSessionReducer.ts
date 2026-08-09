/**
 * Pure voice-session state machine. No DOM, no WebRTC — the hook maps real
 * provider/media events onto these actions, so the transition logic (including
 * bounded reconnect) is unit-testable without a browser.
 */
import type { VoiceErrorCode, VoiceSessionStatus } from "./types";

export interface VoiceSessionState {
  status: VoiceSessionStatus;
  muted: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  interrupted: boolean;
  error?: VoiceErrorCode;
}

export type VoiceSessionAction =
  | { type: "request_permission" }
  | { type: "connecting" }
  | { type: "connected" }
  | { type: "listening" }
  | { type: "user_speech_started" }
  | { type: "user_speech_stopped" }
  | { type: "processing" }
  | { type: "assistant_speaking" }
  | { type: "assistant_stopped" }
  | { type: "mute" }
  | { type: "unmute" }
  | { type: "interrupt" }
  | { type: "disconnected"; recoverable: boolean }
  | { type: "reconnected" }
  | { type: "error"; code: VoiceErrorCode }
  | { type: "stop" }
  | { type: "stopped" };

export function initialVoiceState(maxReconnectAttempts: number): VoiceSessionState {
  return {
    status: "idle",
    muted: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: Math.max(0, maxReconnectAttempts),
    interrupted: false,
  };
}

/** True for statuses after which no further transitions should occur. */
function isTerminal(status: VoiceSessionStatus): boolean {
  return status === "stopped";
}

export function voiceSessionReducer(
  state: VoiceSessionState,
  action: VoiceSessionAction,
): VoiceSessionState {
  // Once stopped, only a fresh initial state (new session) resumes activity.
  if (isTerminal(state.status) && action.type !== "request_permission") {
    return state;
  }

  switch (action.type) {
    case "request_permission":
      return {
        ...state,
        status: "requesting_permission",
        error: undefined,
        interrupted: false,
        // A fresh start (from idle/stopped) resets reconnect bookkeeping.
        reconnectAttempts:
          state.status === "idle" || state.status === "stopped"
            ? 0
            : state.reconnectAttempts,
      };
    case "connecting":
      return { ...state, status: "connecting", error: undefined };
    case "connected":
      return { ...state, status: "connected", error: undefined };
    case "listening":
      return {
        ...state,
        status: "listening",
        interrupted: false,
        error: undefined,
      };
    case "user_speech_started":
      return { ...state, status: "user_speaking" };
    case "user_speech_stopped":
      // After the user stops, we wait for transcript + AiChart → processing.
      return { ...state, status: "processing" };
    case "processing":
      return { ...state, status: "processing" };
    case "assistant_speaking":
      return { ...state, status: "assistant_speaking", interrupted: false };
    case "assistant_stopped":
      return { ...state, status: "listening" };
    case "mute":
      return { ...state, muted: true };
    case "unmute":
      return { ...state, muted: false };
    case "interrupt":
      // Barge-in: stop assistant audio, keep listening. Never auto-terminal.
      return { ...state, status: "listening", interrupted: true };
    case "disconnected": {
      if (!action.recoverable) {
        return { ...state, status: "error", error: "webrtc_failed" };
      }
      if (state.reconnectAttempts >= state.maxReconnectAttempts) {
        // Bounded: give up cleanly instead of looping forever.
        return { ...state, status: "error", error: "network_lost" };
      }
      return {
        ...state,
        status: "reconnecting",
        reconnectAttempts: state.reconnectAttempts + 1,
      };
    }
    case "reconnected":
      return {
        ...state,
        status: "listening",
        reconnectAttempts: 0,
        error: undefined,
        interrupted: false,
      };
    case "error":
      return { ...state, status: "error", error: action.code };
    case "stop":
      return { ...state, status: "stopping" };
    case "stopped":
      return {
        ...initialVoiceState(state.maxReconnectAttempts),
        status: "stopped",
      };
    default:
      return state;
  }
}

/** Should the hook attempt a reconnect for this state? */
export function shouldReconnect(state: VoiceSessionState): boolean {
  return (
    state.status === "reconnecting" &&
    state.reconnectAttempts <= state.maxReconnectAttempts
  );
}
