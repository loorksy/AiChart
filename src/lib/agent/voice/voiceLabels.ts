/**
 * Pure mapping from voice status/error codes to i18n keys. Keeps the UI thin and
 * the label choices unit-testable (and guarantees every code has a message).
 */
import type { TranslationKey } from "@/lib/i18n";
import type { VoiceErrorCode, VoiceSessionStatus } from "./types";

export function voiceStatusKey(status: VoiceSessionStatus): TranslationKey {
  switch (status) {
    case "requesting_permission":
      return "voice.requesting_permission";
    case "connecting":
      return "voice.connecting";
    case "connected":
    case "listening":
      return "voice.listening";
    case "user_speaking":
      return "voice.user_speaking";
    case "processing":
      return "voice.thinking";
    case "assistant_speaking":
      return "voice.speaking";
    case "reconnecting":
      return "voice.reconnecting";
    case "stopping":
    case "stopped":
      return "voice.stopped";
    case "error":
      return "voice.err_generic";
    case "idle":
    default:
      return "voice.ready";
  }
}

export function voiceErrorKey(code: VoiceErrorCode): TranslationKey {
  switch (code) {
    case "mic_permission_denied":
    case "mic_unavailable":
      return "voice.err_mic";
    case "unsupported_browser":
      return "voice.err_unsupported";
    case "network_lost":
    case "webrtc_failed":
    case "datachannel_closed":
    case "session_expired":
      return "voice.err_network";
    case "credential_failed":
    case "credential_expired":
      return "voice.err_credential";
    case "provider_unavailable":
      return "voice.err_provider";
    case "autoplay_blocked":
    case "unknown":
    default:
      return "voice.err_generic";
  }
}
