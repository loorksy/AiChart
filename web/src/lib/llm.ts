/**
 * Unified LLM layer. The platform standardizes on OpenAI.
 * Trading analysis uses the Responses adapter + user model preferences.
 * AI_MODEL remains a seed/fallback for non-trading Chat Completions callers
 * and emergency rollback — not dual authority for trading decisions.
 */

import {
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

/** OpenAI is the only supported provider. Kept as a named type for callers. */
export type LLMProvider = "openai";

export const LLM_PROVIDERS: { id: LLMProvider; label: string }[] = [
  { id: "openai", label: "OpenAI" },
];

const PROVIDER_KEY_FIELD: Record<LLMProvider, string> = {
  openai: "OPENAI_API_KEY",
};

const DEFAULT_MODEL = "gpt-4.1";

export function getActiveProvider(): LLMProvider {
  return "openai";
}

/**
 * Active OpenAI model for non-trading Chat Completions callers.
 * Trading decisions use per-user preferences + probed registry instead.
 */
export function getActiveModel(): string {
  return getPlatformValue("AI_MODEL")?.trim() || DEFAULT_MODEL;
}

export function providerKeyField(provider: LLMProvider = "openai"): string {
  return PROVIDER_KEY_FIELD[provider];
}

export function getProviderApiKey(provider: LLMProvider = "openai"): string | undefined {
  return getPlatformValue(PROVIDER_KEY_FIELD[provider]);
}

export function isLLMConfigured(): boolean {
  return Boolean(getProviderApiKey("openai"));
}

/**
 * Accurate LLM-configured check for server components: `getPlatformValue`
 * (sync) only sees the cache + env, so a DB-stored `OPENAI_API_KEY` reads as
 * missing on a cold render. This awaits the DB, avoiding a false "AI off".
 */
export async function isLLMConfiguredAsync(): Promise<boolean> {
  return Boolean(await getPlatformValueAsync(PROVIDER_KEY_FIELD.openai));
}

function compatModelId(model: string): string {
  // Tolerate a legacy "openai/" prefix on stored model ids.
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

function compatTarget(): OpenAICompatTarget {
  const apiKey = getProviderApiKey("openai");
  if (!apiKey) {
    throw new Error("مفتاح OpenAI غير مُعدّ. أضِفه من لوحة المفاتيح.");
  }
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey,
    model: compatModelId(getActiveModel()),
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

export async function callLLM(params: LLMCallParams): Promise<AnthropicResponse> {
  return callOpenAICompat(compatTarget(), {
    ...params,
    system: flattenSystem(params.system),
  });
}

export async function callLLMStream(
  params: LLMCallParams,
  handlers?: StreamHandlers,
): Promise<AnthropicResponse> {
  return callOpenAICompatStream(
    compatTarget(),
    { ...params, system: flattenSystem(params.system) },
    handlers,
  );
}

export type { AnthropicResponse, ContentBlock, Message, StreamHandlers, ToolDef } from "./anthropic";
