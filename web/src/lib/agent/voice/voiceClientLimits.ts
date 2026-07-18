/**
 * Client-safe voice session cost limits. Mirrors server defaults in
 * voiceSessionConfig.ts — the browser uses these for idle/max timers after the
 * official realtime-session SDP proxy (which returns SDP only, not JSON limits).
 */
import type { VoiceSessionLimits } from "./types";

export function readVoiceLimits(): VoiceSessionLimits {
  return {
    maxMinutes: 10,
    idleTimeoutSeconds: 45,
    maxReconnectAttempts: 3,
  };
}
