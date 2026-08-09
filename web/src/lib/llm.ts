/**
 * Unified LLM layer. First-class providers: OpenAI (OpenAI-compatible client),
 * Anthropic Claude (native Messages API), and OpenRouter (OpenAI-compatible
 * gateway at https://openrouter.ai — test-only, admin-toggleable).
 * The operator picks the provider + model from the admin keys panel
 * (AI_PROVIDER / AI_MODEL / ANTHROPIC_MODEL / OPENROUTER_*); every
 * chat/analysis call routes through the active provider.
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
import { AsyncLocalStorage } from "node:async_hooks";
import { isAllowedModelRef } from "./modelCatalog";
import { getPlatformValue, getPlatformValueAsync } from "./platformConfig";
import { recordLLMUsage } from "./billing/usageMeter";
import { createLogger } from "./logger";
import { getPublicAppUrl } from "./appUrl";

const llmLog = createLogger("llm");

/**
 * Per-request model selection.
 *
 * The operator supplies API keys; the USER picks which brain answers their
 * request, from the chat composer. The choice must apply to every LLM call
 * inside that one request — the decision synthesizer, the ticker, suggestions —
 * without threading a parameter through a dozen call sites, and without leaking
 * into concurrent requests from other users. AsyncLocalStorage is exactly that
 * scope: set once at the route boundary, read by `getActiveProvider`/
 * `modelForTier`, and gone when the request ends.
 */
export interface RequestModelSelection {
  provider: LLMProvider;
  model: string;
}

const requestModel = new AsyncLocalStorage<RequestModelSelection>();

/** Run `fn` with every LLM call inside it pinned to `selection`. */
export function withRequestModel<T>(
  selection: RequestModelSelection | null,
  fn: () => T,
): T {
  return selection ? requestModel.run(selection, fn) : fn();
}

export function currentRequestModel(): RequestModelSelection | undefined {
  return requestModel.getStore();
}

/**
 * Resolve a user's stored preference into an applicable selection.
 *
 * Returns null — meaning "use the platform default" — when the preference is
 * unset, malformed, outside the curated model catalogue, or names a provider
 * that is not ready (missing key, or OpenRouter disabled). A user must never
 * be able to point the platform at a provider it cannot authenticate against,
 * nor at a model the platform has not committed to.
 */
export async function resolveUserModelSelection(
  ref?: string | null,
): Promise<RequestModelSelection | null> {
  const parsed = parseModelRef(ref);
  if (!parsed) return null;
  if (!(await isOfferedModelRef(parsed))) return null;
  return (await isProviderReadyAsync(parsed.provider)) ? parsed : null;
}

/**
 * The catalogue plus the admin's own configured default — a stored preference
 * equal to the platform default must keep working even if that default was set
 * outside the curated list.
 */
export async function isOfferedModelRef(
  parsed: RequestModelSelection,
): Promise<boolean> {
  if (isAllowedModelRef(`${parsed.provider}/${parsed.model}`)) return true;
  const configuredField =
    parsed.provider === "anthropic"
      ? "ANTHROPIC_MODEL"
      : parsed.provider === "openrouter"
        ? "OPENROUTER_MODEL"
        : "AI_MODEL";
  const configured = (await getPlatformValueAsync(configuredField))?.trim();
  return Boolean(configured) && configured === parsed.model;
}

export function parseModelRef(ref?: string | null): RequestModelSelection | null {
  const raw = ref?.trim();
  if (!raw) return null;
  const slash = raw.indexOf("/");
  if (slash <= 0) return null;
  const provider = raw.slice(0, slash);
  const model = raw.slice(slash + 1).trim();
  if (!model) return null;
  if (
    provider !== "openai" &&
    provider !== "anthropic" &&
    provider !== "openrouter"
  ) {
    return null;
  }
  return { provider, model };
}

export type LLMProvider = "openai" | "anthropic" | "openrouter";

export const LLM_PROVIDERS: { id: LLMProvider; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openrouter", label: "OpenRouter (اختبار)" },
];

const PROVIDER_KEY_FIELD: Record<LLMProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

function normalizeProviderFlag(raw?: string | null): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** OpenRouter is opt-in for testing; missing/blank means off. */
export function isOpenRouterEnabled(): boolean {
  return normalizeProviderFlag(getPlatformValue("OPENROUTER_ENABLED"));
}

export async function isOpenRouterEnabledAsync(): Promise<boolean> {
  return normalizeProviderFlag(await getPlatformValueAsync("OPENROUTER_ENABLED"));
}

export function parsePlatformProvider(raw?: string | null): LLMProvider {
  const v = raw?.trim();
  if (v === "anthropic") return "anthropic";
  if (v === "openrouter") return "openrouter";
  return "openai";
}

/** Key present, and (for OpenRouter) the admin enable toggle is on. */
export function isProviderReady(provider: LLMProvider): boolean {
  if (!getProviderApiKey(provider)?.trim()) return false;
  if (provider === "openrouter") return isOpenRouterEnabled();
  return true;
}

export async function isProviderReadyAsync(provider: LLMProvider): Promise<boolean> {
  const key = (await getPlatformValueAsync(PROVIDER_KEY_FIELD[provider]))?.trim();
  if (!key) return false;
  if (provider === "openrouter") return isOpenRouterEnabledAsync();
  return true;
}

export function getActiveProvider(): LLMProvider {
  // The user's per-request pick wins over the platform default.
  const picked = requestModel.getStore();
  if (picked) return picked.provider;
  return parsePlatformProvider(getPlatformValue("AI_PROVIDER"));
}

/** Active model for the active provider (with safe defaults). */
export function getActiveModel(): string {
  const picked = requestModel.getStore();
  if (picked) return picked.model;
  const provider = getActiveProvider();
  if (provider === "anthropic") {
    return getPlatformValue("ANTHROPIC_MODEL")?.trim() || DEFAULT_ANTHROPIC_MODEL;
  }
  if (provider === "openrouter") {
    return getPlatformValue("OPENROUTER_MODEL")?.trim() || DEFAULT_OPENROUTER_MODEL;
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
  // An explicit user pick is honoured for every tier — splitting their chosen
  // model across tiers would silently answer with a model they did not choose.
  if (requestModel.getStore()) return getDeepModel();
  const provider = getActiveProvider();
  if (provider === "anthropic") {
    return getPlatformValue("ANTHROPIC_QUICK_MODEL")?.trim() || getDeepModel();
  }
  if (provider === "openrouter") {
    return getPlatformValue("OPENROUTER_QUICK_MODEL")?.trim() || getDeepModel();
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
  return isProviderReady(getActiveProvider());
}

/**
 * Accurate LLM-configured check for server components: `getPlatformValue`
 * (sync) only sees the cache + env, so a DB-stored key reads as missing on a
 * cold render. This awaits the DB, avoiding a false "AI off".
 */
export async function isLLMConfiguredAsync(): Promise<boolean> {
  const provider = parsePlatformProvider(
    await getPlatformValueAsync("AI_PROVIDER"),
  );
  return isProviderReadyAsync(provider);
}

function compatModelId(model: string): string {
  // Tolerate a legacy "openai/" prefix on stored model ids.
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

function openaiCompatTarget(model: string): OpenAICompatTarget {
  const apiKey = getProviderApiKey("openai");
  if (!apiKey) {
    throw new Error("مفتاح OpenAI غير مُعدّ. أضِفه من لوحة المفاتيح.");
  }
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey,
    model: compatModelId(model),
    resilienceKey: "openai",
  };
}

function openRouterCompatTarget(model: string): OpenAICompatTarget {
  if (!isOpenRouterEnabled()) {
    throw new Error(
      "OpenRouter معطّل من لوحة الإدارة. فعّل OPENROUTER_ENABLED للاختبارات.",
    );
  }
  const apiKey = getProviderApiKey("openrouter");
  if (!apiKey) {
    throw new Error("مفتاح OpenRouter غير مُعدّ. أضِفه من لوحة المفاتيح.");
  }
  // OpenRouter model ids keep the upstream vendor prefix (openai/…, anthropic/…).
  return {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey,
    model,
    resilienceKey: "openrouter",
    headers: {
      "HTTP-Referer": getPublicAppUrl(),
      "X-Title": "AiChart",
    },
  };
}

function compatTargetFor(provider: LLMProvider, model: string): OpenAICompatTarget {
  if (provider === "openrouter") return openRouterCompatTarget(model);
  return openaiCompatTarget(model);
}

/**
 * V2-A1: every successful call meters its provider-reported token counts.
 * Fire-and-forget by design — metering must never slow or fail a call.
 */
function meterUsage(provider: LLMProvider, model: string, res: AnthropicResponse): void {
  recordLLMUsage({
    provider,
    model,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  });
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
    const res =
      provider === "anthropic"
        ? // Native Messages API — the platform's internal wire shape already IS
          // Anthropic's, so no translation layer is needed on this path.
          await callAnthropic({ ...params, model, signal: opts?.signal })
        : await callOpenAICompat(compatTargetFor(provider, model), {
            ...params,
            system: flattenSystem(params.system),
            signal: opts?.signal,
          });
    meterUsage(provider, model, res);
    return res;
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
    const res =
      provider === "anthropic"
        ? await callAnthropicStream(
            { ...params, model, signal: opts?.signal },
            handlers,
          )
        : await callOpenAICompatStream(
            compatTargetFor(provider, model),
            { ...params, system: flattenSystem(params.system), signal: opts?.signal },
            handlers,
          );
    meterUsage(provider, model, res);
    return res;
  } finally {
    llmLog.debug("llm.call.stream", { provider, tier, model, durationMs: Math.round(performance.now() - started) });
  }
}

export type { AnthropicResponse, ContentBlock, Message, StreamHandlers, ToolDef } from "./anthropic";
