/**
 * Unified LLM layer. Two first-class providers: OpenAI (via the
 * OpenAI-compatible client) and Anthropic Claude (native Messages API client).
 * The operator picks the provider + model from the admin keys panel
 * (AI_PROVIDER / AI_MODEL / ANTHROPIC_MODEL); every chat/analysis call routes
 * through the active provider.
 */

import {
  callAnthropic,
  callAnthropicStream,
  DEFAULT_ANTHROPIC_MODEL,
  type AnthropicResponse,
  type Message,
  type StreamHandlers,
  type SystemPromptInput,
  type ToolDef,
} from "./anthropic";
import {
  callOpenAICompat,
  callOpenAICompatStream,
  type OpenAICompatTarget,
} from "./openaiCompat";
import { getPlatformValue, getPlatformValueAsync } from "./platformConfig";
import { createLogger } from "./logger";

const llmLog = createLogger("llm");

export type LLMProvider = "openai" | "anthropic";

export const LLM_PROVIDERS: { id: LLMProvider; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic (Claude)" },
];

const PROVIDER_KEY_FIELD: Record<LLMProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const DEFAULT_MODEL = "gpt-4.1";

export function getActiveProvider(): LLMProvider {
  return getPlatformValue("AI_PROVIDER")?.trim() === "anthropic"
    ? "anthropic"
    : "openai";
}

/** Active model for the active provider (with safe defaults). */
export function getActiveModel(): string {
  if (getActiveProvider() === "anthropic") {
    return getPlatformValue("ANTHROPIC_MODEL")?.trim() || DEFAULT_ANTHROPIC_MODEL;
  }
  return getPlatformValue("AI_MODEL")?.trim() || DEFAULT_MODEL;
}

/**
 * Model tiers (RELIABILITY_PLAN.md item 15): the deep model owns the trade
 * decision; a cheaper/faster model may serve auxiliary generations (ticker,
 * suggestions, status/general replies, drawing narration). The split is
 * OPT-IN — `getQuickModel()` falls back to the deep model, so with no
 * `AI_QUICK_MODEL` configured behavior is byte-for-byte unchanged and the
 * decision path is never downgraded.
 */
export type ModelTier = "quick" | "deep";

/** Strong model for the final decision + any execution-grade reasoning. */
export function getDeepModel(): string {
  return getActiveModel();
}

/** Fast/cheap model for auxiliary generations; defaults to the deep model. */
export function getQuickModel(): string {
  if (getActiveProvider() === "anthropic") {
    return getPlatformValue("ANTHROPIC_QUICK_MODEL")?.trim() || getDeepModel();
  }
  return getPlatformValue("AI_QUICK_MODEL")?.trim() || getDeepModel();
}

export function modelForTier(tier: ModelTier): string {
  return tier === "quick" ? getQuickModel() : getDeepModel();
}

export function providerKeyField(provider: LLMProvider = "openai"): string {
  return PROVIDER_KEY_FIELD[provider];
}

export function getProviderApiKey(provider: LLMProvider = "openai"): string | undefined {
  return getPlatformValue(PROVIDER_KEY_FIELD[provider]);
}

export function isLLMConfigured(): boolean {
  return Boolean(getProviderApiKey(getActiveProvider()));
}

/**
 * Accurate LLM-configured check for server components: `getPlatformValue`
 * (sync) only sees the cache + env, so a DB-stored key reads as missing on a
 * cold render. This awaits the DB, avoiding a false "AI off".
 */
export async function isLLMConfiguredAsync(): Promise<boolean> {
  const provider: LLMProvider =
    (await getPlatformValueAsync("AI_PROVIDER"))?.trim() === "anthropic"
      ? "anthropic"
      : "openai";
  return Boolean(await getPlatformValueAsync(PROVIDER_KEY_FIELD[provider]));
}

function compatModelId(model: string): string {
  // Tolerate a legacy "openai/" prefix on stored model ids.
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

function compatTarget(model: string): OpenAICompatTarget {
  const apiKey = getProviderApiKey("openai");
  if (!apiKey) {
    throw new Error("مفتاح OpenAI غير مُعدّ. أضِفه من لوحة المفاتيح.");
  }
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey,
    model: compatModelId(model),
  };
}

export interface LLMCallParams {
  system: SystemPromptInput;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
}

function flattenSystem(system: SystemPromptInput): string {
  if (typeof system === "string") return system;
  return system.dynamic?.trim()
    ? `${system.static}\n\n${system.dynamic}`
    : system.static;
}

export interface LLMCallOptions {
  /** Which model tier serves this call. Defaults to "deep". */
  tier?: ModelTier;
  /**
   * Caller cancellation/deadline (RELIABILITY_PLAN.md item 2). When it aborts,
   * the in-flight HTTP request is torn down — not merely un-awaited — so a
   * timed-out or cancelled stage stops burning provider quota and CPU.
   */
  signal?: AbortSignal;
}

export async function callLLM(
  params: LLMCallParams,
  opts?: LLMCallOptions,
): Promise<AnthropicResponse> {
  const provider = getActiveProvider();
  const tier = opts?.tier ?? "deep";
  const model = modelForTier(tier);
  const started = performance.now();
  try {
    if (provider === "anthropic") {
      // Native Messages API — the platform's internal wire shape already IS
      // Anthropic's, so no translation layer is needed on this path.
      return await callAnthropic({ ...params, model, signal: opts?.signal });
    }
    return await callOpenAICompat(compatTarget(model), {
      ...params,
      system: flattenSystem(params.system),
      signal: opts?.signal,
    });
  } finally {
    // Before/after measurement (item 15): tier + model + wall time, no content.
    llmLog.debug("llm.call", { provider, tier, model, durationMs: Math.round(performance.now() - started) });
  }
}

export async function callLLMStream(
  params: LLMCallParams,
  handlers?: StreamHandlers,
  opts?: LLMCallOptions,
): Promise<AnthropicResponse> {
  const provider = getActiveProvider();
  const tier = opts?.tier ?? "deep";
  const model = modelForTier(tier);
  const started = performance.now();
  try {
    if (provider === "anthropic") {
      return await callAnthropicStream(
        { ...params, model, signal: opts?.signal },
        handlers,
      );
    }
    return await callOpenAICompatStream(
      compatTarget(model),
      { ...params, system: flattenSystem(params.system), signal: opts?.signal },
      handlers,
    );
  } finally {
    llmLog.debug("llm.call.stream", { provider, tier, model, durationMs: Math.round(performance.now() - started) });
  }
}

export type { AnthropicResponse, ContentBlock, Message, StreamHandlers, ToolDef } from "./anthropic";
