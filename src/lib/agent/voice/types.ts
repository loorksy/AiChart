/**
 * Provider-independent voice types. UI + hooks depend ONLY on these — never on
 * a specific realtime provider's raw event names. The OpenAI Realtime adapter
 * normalizes its events into these shapes so the provider stays replaceable.
 */

export type VoiceSessionStatus =
  | "idle"
  | "requesting_permission"
  | "connecting"
  | "connected"
  | "listening"
  | "user_speaking"
  | "processing"
  | "assistant_speaking"
  | "reconnecting"
  | "stopping"
  | "stopped"
  | "error";

export type VoiceTranscriptEvent = {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
  createdAt: number;
};

export type VoiceSessionContext = {
  chatId: string;
  locale: "ar" | "en";
  symbol: string;
  interval: string;
  sessionId?: string;
};

/** A normalized realtime event the provider emits to the hook. Never a raw
 *  provider payload — the adapter maps its transport events into one of these. */
export type VoiceProviderEvent =
  | { kind: "status"; status: VoiceSessionStatus }
  | { kind: "transcript"; transcript: VoiceTranscriptEvent }
  | { kind: "user_speech_started" }
  | { kind: "user_speech_stopped" }
  | { kind: "assistant_audio_started" }
  | { kind: "assistant_audio_stopped" }
  | { kind: "error"; code: VoiceErrorCode; message?: string };

export type VoiceErrorCode =
  | "mic_permission_denied"
  | "mic_unavailable"
  | "unsupported_browser"
  | "network_lost"
  | "credential_failed"
  | "credential_expired"
  | "webrtc_failed"
  | "datachannel_closed"
  | "autoplay_blocked"
  | "provider_unavailable"
  | "session_expired"
  | "unknown";

/** Whether an error is worth a bounded reconnect, or terminal. */
export function isRecoverableVoiceError(code: VoiceErrorCode): boolean {
  switch (code) {
    case "network_lost":
    case "credential_expired":
    case "webrtc_failed":
    case "datachannel_closed":
    case "session_expired":
      return true;
    default:
      return false;
  }
}

/** The short-lived, browser-safe session info returned by the server endpoint.
 *  It NEVER contains the standard API key — only an ephemeral client secret. */
export interface VoiceSessionCredential {
  clientSecret: string;
  expiresAt: number;
  model: string;
  voice: string;
  sessionId: string;
  limits: VoiceSessionLimits;
}

export interface VoiceSessionLimits {
  maxMinutes: number;
  idleTimeoutSeconds: number;
  maxReconnectAttempts: number;
}

/**
 * The replaceable provider session contract. A concrete provider (OpenAI
 * Realtime over WebRTC) implements this; the UI/hook only ever sees this shape.
 */
export interface VoiceProviderSession {
  start(): Promise<void>;
  stop(): Promise<void>;
  mute(): void;
  unmute(): void;
  interrupt(): void;
  sendText(text: string): void;
  speakText(text: string): Promise<void>;
}
