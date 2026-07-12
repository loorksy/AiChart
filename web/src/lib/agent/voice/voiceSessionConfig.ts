/**
 * Server-side voice session configuration. Reads realtime model/voice and cost
 * limits from environment variables with conservative defaults, and derives a
 * privacy-preserving stable safety identifier from the internal user id.
 *
 * SERVER ONLY: this reads process.env (the standard API key) and node:crypto.
 * Never import it into client bundles — the client receives only the minimal,
 * short-lived `VoiceSessionCredential` from the session endpoint.
 */
import { createHash } from "node:crypto";
import type { VoiceSessionLimits } from "./types";

/** GA Realtime defaults (overridable via env). */
const DEFAULT_MODEL = "gpt-realtime";
const DEFAULT_VOICE = "alloy";

const DEFAULT_MAX_MINUTES = 10;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 45;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function readVoiceLimits(): VoiceSessionLimits {
  return {
    maxMinutes: intEnv("VOICE_SESSION_MAX_MINUTES", DEFAULT_MAX_MINUTES, 1, 60),
    idleTimeoutSeconds: intEnv(
      "VOICE_IDLE_TIMEOUT_SECONDS",
      DEFAULT_IDLE_TIMEOUT_SECONDS,
      10,
      600,
    ),
    maxReconnectAttempts: intEnv(
      "VOICE_MAX_RECONNECT_ATTEMPTS",
      DEFAULT_MAX_RECONNECT_ATTEMPTS,
      0,
      10,
    ),
  };
}

export interface VoiceServerConfig {
  apiKey: string;
  model: string;
  voice: string;
  limits: VoiceSessionLimits;
}

/** The standard API key + realtime settings. Throws if no key is configured. */
export function getVoiceServerConfig(): VoiceServerConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("voice_not_configured");
  }
  return {
    apiKey,
    model: process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_MODEL,
    voice: process.env.OPENAI_REALTIME_VOICE?.trim() || DEFAULT_VOICE,
    limits: readVoiceLimits(),
  };
}

export function isVoiceConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * A stable, non-reversible identifier for provider abuse/safety signals. It is
 * derived from the internal user id + a server salt so the provider never sees
 * the real user id, yet the same user maps to the same value across sessions.
 */
export function voiceSafetyIdentifier(userId: number): string {
  const salt = process.env.VOICE_SAFETY_SALT?.trim() || "lonora-voice-safety";
  return createHash("sha256").update(`${salt}:${userId}`).digest("hex").slice(0, 32);
}
