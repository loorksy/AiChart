/**
 * Unified LLM layer. First-class providers: OpenAI (OpenAI-compatible client)
 * and Anthropic Claude (native Messages API). The operator picks the provider
 * + model from the admin keys panel (AI_PROVIDER / AI_MODEL / ANTHROPIC_MODEL);
 * every chat/analysis call routes through the active provider.
 */

import {
  callAnthropic,
  callAnthropicStream,
  listAnthropicModels,
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
  listOpenAIChatModels,
  type OpenAICompatTarget,
} from "./openaiCompat";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  LLM_PROVIDERS,
  providerLabel,
  providerOfFailure,
  tagProviderFailure,
  type LLMProvider,
} from "./providerIdentity";
import { isAllowedModelRef } from "./modelCatalog";
import {
  getPlatformValue,
  getPlatformValueAsync,
  refreshPlatformConfigIfStale,
} from "./platformConfig";
import { recordLLMUsage } from "./billing/usageMeter";
import { createLogger } from "./logger";

const llmLog = createLogger("llm");

// Identity (who the providers are) is pure and lives in providerIdentity so a
// client component can name a provider without importing this server module.
// Re-exported here because this module is the LLM layer's front door.
export {
  LLM_PROVIDERS,
  providerLabel,
  providerOfFailure,
  tagProviderFailure,
  isLLMProvider,
} from "./providerIdentity";
export type { LLMProvider } from "./providerIdentity";

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
 * Returns null — meaning "use the operator's active provider and model" —
 * when the preference is unset, malformed, outside the curated catalogue,
 * names a provider that is not ready (missing key), or names a provider that
 * is NOT the operator's active one.
 *
 * That last rule is the important one. A stored per-user pick used to be
 * honoured whenever its provider merely had a key on file, so a preference
 * saved months ago ("openai/gpt-4.1") kept pinning every one of that user's
 * runs to OpenAI after the operator had switched the platform to Anthropic —
 * and since the pin only covers the main run, side generations (suggestions)
 * followed the new provider while analysis and chat kept failing on the old
 * one's exhausted billing. A user's convenience pick may narrow WHICH model
 * of the active provider answers; it may never choose a different provider
 * than the operator did.
 */
export async function resolveUserModelSelection(
  ref?: string | null,
): Promise<RequestModelSelection | null> {
  const parsed = parseModelRef(ref);
  if (!parsed) return null;
  if (parsed.provider !== (await getActiveProviderAsync())) return null;
  if (!(await isOfferedModelRef(parsed))) return null;
  return (await isProviderReadyAsync(parsed.provider)) ? parsed : null;
}

/**
 * Why a stored/offered model ref is not usable right now — so a picker can
 * refuse it by NAME instead of letting the run fail later against the wrong
 * provider's billing.
 */
export type ModelRefRejection =
  | "malformed"
  | "provider_not_active"
  | "not_offered"
  | "provider_not_ready";

export async function checkModelRef(
  ref?: string | null,
): Promise<{ ok: true; selection: RequestModelSelection } | { ok: false; reason: ModelRefRejection; activeProvider: LLMProvider }> {
  const active = await getActiveProviderAsync();
  const parsed = parseModelRef(ref);
  if (!parsed) return { ok: false, reason: "malformed", activeProvider: active };
  if (parsed.provider !== active) {
    return { ok: false, reason: "provider_not_active", activeProvider: active };
  }
  if (!(await isOfferedModelRef(parsed))) {
    return { ok: false, reason: "not_offered", activeProvider: active };
  }
  if (!(await isProviderReadyAsync(parsed.provider))) {
    return { ok: false, reason: "provider_not_ready", activeProvider: active };
  }
  return { ok: true, selection: parsed };
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
    parsed.provider === "anthropic" ? "ANTHROPIC_MODEL" : "AI_MODEL";
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
  if (provider !== "openai" && provider !== "anthropic") {
    return null;
  }
  return { provider, model };
}

const PROVIDER_KEY_FIELD: Record<LLMProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const DEFAULT_MODEL = "gpt-4.1";

/**
 * The model the call will actually use.
 */
async function modelForTierAsync(tier: ModelTier): Promise<string> {
  return modelForTier(tier);
}

/** Unset/unrecognized falls back to this — Sonnet is the platform's brain. */
export const PLATFORM_DEFAULT_PROVIDER: LLMProvider = "anthropic";

export function parsePlatformProvider(raw?: string | null): LLMProvider {
  const v = raw?.trim();
  if (v === "openai") return "openai";
  // Unset (or anything unrecognized) means the platform default: Anthropic,
  // whose default model (Sonnet 4.6) is the platform's default brain.
  return PLATFORM_DEFAULT_PROVIDER;
}

/** Key present for this first-class provider. */
export function isProviderReady(provider: LLMProvider): boolean {
  return Boolean(getProviderApiKey(provider)?.trim());
}

export async function isProviderReadyAsync(provider: LLMProvider): Promise<boolean> {
  const key = (await getPlatformValueAsync(PROVIDER_KEY_FIELD[provider]))?.trim();
  return Boolean(key);
}

/**
 * The operator's EXPLICIT provider choice, or null when they never made one.
 *
 * `parsePlatformProvider` cannot answer this: it folds "unset" and every
 * unrecognized value into the platform default, which makes an explicit
 * choice indistinguishable from no choice at all.
 */
function operatorProviderChoice(raw: string | undefined): LLMProvider | null {
  const v = raw?.trim().toLowerCase();
  if (v === "openai") return "openai";
  if (v === "anthropic") return "anthropic";
  return null;
}

/**
 * Which provider answers, given an operator choice and the keys on file.
 *
 * An EXPLICIT choice is absolute — no path may quietly answer on a provider
 * the operator did not pick, because a silent substitution is exactly what
 * makes a failure unreadable ("I switched to Anthropic and it still bills
 * OpenAI"). When the operator has made NO choice, and only then, the
 * platform infers one from the keys that exist: that is not overriding
 * anybody, it is bootstrapping a fresh install.
 */
function decideProvider(
  choice: LLMProvider | null,
  ready: (p: LLMProvider) => boolean,
): LLMProvider {
  if (choice) return choice;
  if (ready(PLATFORM_DEFAULT_PROVIDER)) return PLATFORM_DEFAULT_PROVIDER;
  for (const p of LLM_PROVIDERS) {
    if (ready(p.id)) return p.id;
  }
  return PLATFORM_DEFAULT_PROVIDER;
}

export function getActiveProvider(): LLMProvider {
  // The user's per-request pick wins — but only ever WITHIN the operator's
  // provider (resolveUserModelSelection refuses to pin anything else).
  const picked = requestModel.getStore();
  if (picked) return picked.provider;
  return decideProvider(operatorProviderChoice(getPlatformValue("AI_PROVIDER")), isProviderReady);
}

/**
 * The DB-backed answer, and the one every decision should use.
 *
 * The sync reader above can only see what the in-process cache already
 * holds; this awaits the database, and first lets a stale snapshot refresh
 * so a provider switched in the admin panel takes effect in a long-lived
 * worker WITHOUT restarting it.
 */
export async function getActiveProviderAsync(): Promise<LLMProvider> {
  const picked = requestModel.getStore();
  if (picked) return picked.provider;
  await refreshPlatformConfigIfStale();
  const choice = operatorProviderChoice(await getPlatformValueAsync("AI_PROVIDER"));
  const readiness = await Promise.all(LLM_PROVIDERS.map((p) => isProviderReadyAsync(p.id)));
  const ready = (p: LLMProvider) =>
    readiness[LLM_PROVIDERS.findIndex((x) => x.id === p)] ?? false;
  return decideProvider(choice, ready);
}

/** The one selection a call should run with: provider + model for a tier. */
export async function resolveActiveSelection(
  tier: ModelTier = "deep",
): Promise<RequestModelSelection> {
  const picked = requestModel.getStore();
  if (picked) return picked;
  const provider = await getActiveProviderAsync();
  const field =
    provider === "anthropic"
      ? tier === "quick"
        ? "ANTHROPIC_QUICK_MODEL"
        : "ANTHROPIC_MODEL"
      : tier === "quick"
        ? "AI_QUICK_MODEL"
        : "AI_MODEL";
  const configured = (await getPlatformValueAsync(field))?.trim();
  if (configured) return { provider, model: configured };
  // The quick tier is OPT-IN: with no cheap model configured it falls back
  // to the deep model rather than inventing one.
  if (tier === "quick") return resolveActiveSelection("deep");
  return {
    provider,
    model: provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_MODEL,
  };
}

/** Active model for the active provider (with safe defaults). */
export function getActiveModel(): string {
  const picked = requestModel.getStore();
  if (picked) return picked.model;
  const provider = getActiveProvider();
  if (provider === "anthropic") {
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
  // An explicit user pick is honoured for every tier — splitting their chosen
  // model across tiers would silently answer with a model they did not choose.
  if (requestModel.getStore()) return getDeepModel();
  const provider = getActiveProvider();
  if (provider === "anthropic") {
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

/** DB-backed key read — for processes whose sync cache may be a boot snapshot. */
export async function getProviderApiKeyAsync(
  provider: LLMProvider,
): Promise<string | undefined> {
  return (await getPlatformValueAsync(PROVIDER_KEY_FIELD[provider]))?.trim() || undefined;
}

export function isLLMConfigured(): boolean {
  return LLM_PROVIDERS.some((p) => isProviderReady(p.id));
}

/**
 * Accurate LLM-configured check for server components: `getPlatformValue`
 * (sync) only sees the cache + env, so a DB-stored key reads as missing on a
 * cold render. This awaits the DB, avoiding a false "AI off".
 *
 * True when ANY first-class provider is ready. The platform default
 * (`AI_PROVIDER`) may still be openai while the operator only pasted a
 * Claude key — the user picker and the fallback in `getActiveProvider`
 * then route to that key. Requiring the default provider specifically is
 * what showed "AI is not enabled" with Claude already selected.
 */
export async function isLLMConfiguredAsync(): Promise<boolean> {
  const flags = await Promise.all(
    LLM_PROVIDERS.map((p) => isProviderReadyAsync(p.id)),
  );
  return flags.some(Boolean);
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

/**
 * Prove a key works, for the admin panel — the ONE place a provider's own
 * endpoint is probed. It lives here because this module is the only one
 * allowed to speak to a provider client; the panel asks, it answers.
 */
export async function verifyProviderKey(
  provider: LLMProvider,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (provider === "openai") {
      await listOpenAIChatModels(apiKey);
    } else {
      await listAnthropicModels(apiKey);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
  const tier = opts?.tier ?? "deep";
  // ONE resolution per call, from the database — never a sync cache guess.
  const { provider, model } = await resolveActiveSelection(tier);
  const started = performance.now();
  try {
    const res =
      provider === "anthropic"
        ? // Native Messages API — the platform's internal wire shape already IS
          // Anthropic's, so no translation layer is needed on this path.
          await callAnthropic({ ...params, model, signal: opts?.signal })
        : await callOpenAICompat(openaiCompatTarget(model), {
            ...params,
            system: flattenSystem(params.system),
            signal: opts?.signal,
          });
    meterUsage(provider, model, res);
    return res;
  } catch (err) {
    // Name the provider ON the error. Downstream the operator reads
    // "OpenAI is out of credit", not "the AI account is out of credit" —
    // the ambiguity that had them topping up the wrong account.
    throw tagProviderFailure(err, provider);
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
  const tier = opts?.tier ?? "deep";
  const { provider, model } = await resolveActiveSelection(tier);
  const started = performance.now();
  try {
    const res =
      provider === "anthropic"
        ? await callAnthropicStream(
            { ...params, model, signal: opts?.signal },
            handlers,
          )
        : await callOpenAICompatStream(
            openaiCompatTarget(model),
            { ...params, system: flattenSystem(params.system), signal: opts?.signal },
            handlers,
          );
    meterUsage(provider, model, res);
    return res;
  } catch (err) {
    throw tagProviderFailure(err, provider);
  } finally {
    llmLog.debug("llm.call.stream", { provider, tier, model, durationMs: Math.round(performance.now() - started) });
  }
}

export type { AnthropicResponse, ContentBlock, Message, StreamHandlers, ToolDef } from "./anthropic";
