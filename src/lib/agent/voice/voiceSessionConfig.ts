/**
 * Server-side voice session configuration. Reads the API key + realtime model
 * from platformConfig (DB-backed, with env-var fallback) and cost limits from
 * environment variables with conservative defaults.
 *
 * SERVER ONLY: this reads platformConfig (the standard API key). Never import it
 * into client bundles — the client receives only the minimal, short-lived
 * `VoiceSessionCredential` from the session endpoint.
 */
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { listOpenAIRealtimeModels } from "@/lib/openaiCompat";
import { createLogger } from "@/lib/logger";
import type { VoiceSessionLimits } from "./types";

const log = createLogger("voice.config");

/**
 * Last-resort realtime model.
 *
 * Used only when the provider's model list is unreachable: the platform
 * normally discovers the newest realtime model from the API, so a new
 * generation is picked up without a code change or a manual admin edit.
 */
const FALLBACK_MODEL = "gpt-realtime";
const DEFAULT_VOICE = "alloy";

/** Discovered newest realtime model; refreshed hourly. */
let realtimeModelCache: { at: number; model: string } | null = null;
const REALTIME_CACHE_MS = 60 * 60 * 1000;

/**
 * The newest realtime model the account can use.
 *
 * `listOpenAIRealtimeModels` sorts by the provider's `created` timestamp, so
 * "newest" is the provider's own answer rather than a version string we tried
 * to parse. Never invents an id: on any failure it returns the last known good
 * value, then the documented fallback.
 */
async function discoverNewestRealtimeModel(apiKey: string): Promise<string> {
  if (realtimeModelCache && Date.now() - realtimeModelCache.at < REALTIME_CACHE_MS) {
    return realtimeModelCache.model;
  }
  try {
    const models = await listOpenAIRealtimeModels(apiKey);
    // Newest FLAGSHIP: a "-mini" sibling ships on the same day and would win a
    // pure date sort, quietly downgrading the voice agent to the small model.
    const newest =
      models.find((m) => !/mini/i.test(m.id))?.id ?? models[0]?.id;
    if (newest) {
      realtimeModelCache = { at: Date.now(), model: newest };
      return newest;
    }
  } catch (error) {
    log.warn("voice.realtime_model_discovery_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return realtimeModelCache?.model ?? FALLBACK_MODEL;
}

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
export async function getVoiceServerConfig(): Promise<VoiceServerConfig> {
  const apiKey = (await getPlatformValueAsync("OPENAI_API_KEY"))?.trim();
  if (!apiKey) {
    throw new Error("voice_not_configured");
  }
  // An explicit admin pin wins; otherwise track the provider's newest model so
  // voice quality improves with each generation without an edit here.
  const pinned = (await getPlatformValueAsync("OPENAI_REALTIME_MODEL"))?.trim();
  const model =
    pinned && pinned !== FALLBACK_MODEL
      ? pinned
      : await discoverNewestRealtimeModel(apiKey);
  return {
    apiKey,
    model,
    voice: process.env.OPENAI_REALTIME_VOICE?.trim() || DEFAULT_VOICE,
    limits: readVoiceLimits(),
  };
}

export async function isVoiceConfigured(): Promise<boolean> {
  return Boolean((await getPlatformValueAsync("OPENAI_API_KEY"))?.trim());
}

