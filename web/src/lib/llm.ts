/**
 * Unified LLM layer: routes chat calls to the provider selected in the admin
 * panel (AI_PROVIDER): anthropic (with prompt caching) | openrouter | openai.
 * Same Message/ToolDef/response shapes as anthropic.ts so callers are
 * provider-agnostic.
 */

import {
  callAnthropic,
  callAnthropicStream,
  getAnthropicModel,
  type AnthropicResponse,
  type Message,
  type StreamHandlers,
  type ToolDef,
} from "./anthropic";
import {
  callOpenAICompat,
  callOpenAICompatStream,
  type OpenAICompatTarget,
} from "./openaiCompat";
import { getPlatformValue } from "./platformConfig";

export type LLMProvider = "anthropic" | "openrouter" | "openai";

export const LLM_PROVIDERS: { id: LLMProvider; label: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "openai", label: "OpenAI" },
];

const PROVIDER_KEY_FIELD: Record<LLMProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
};

const DEFAULT_MODEL: Record<LLMProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openrouter: "anthropic/claude-sonnet-4.5",
  openai: "gpt-4.1",
};

export function getActiveProvider(): LLMProvider {
  const raw = (getPlatformValue("AI_PROVIDER") || "anthropic").toLowerCase();
  if (raw === "openrouter" || raw === "openai") return raw;
  return "anthropic";
}

/** Active model for the active provider (AI_MODEL, with legacy fallback). */
export function getActiveModel(): string {
  const provider = getActiveProvider();
  const model = getPlatformValue("AI_MODEL");
  if (model) return model;
  // Backward compat: anthropic keeps honoring ANTHROPIC_MODEL.
  if (provider === "anthropic") return getAnthropicModel();
  return DEFAULT_MODEL[provider];
}

export function providerKeyField(provider: LLMProvider): string {
  return PROVIDER_KEY_FIELD[provider];
}

export function getProviderApiKey(provider: LLMProvider): string | undefined {
  return getPlatformValue(PROVIDER_KEY_FIELD[provider]);
}

export function isLLMConfigured(): boolean {
  return Boolean(getProviderApiKey(getActiveProvider()));
}

function compatTarget(provider: "openrouter" | "openai"): OpenAICompatTarget {
  const apiKey = getProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(
      provider === "openrouter"
        ? "مفتاح OpenRouter غير مُعدّ. أضِفه من لوحة المفاتيح."
        : "مفتاح OpenAI غير مُعدّ. أضِفه من لوحة المفاتيح.",
    );
  }
  if (provider === "openrouter") {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey,
      model: getActiveModel(),
      headers: {
        "HTTP-Referer": getPlatformValue("APP_URL") || "https://aichart.app",
        "X-Title": "AiChart",
      },
    };
  }
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey,
    model: getActiveModel(),
  };
}

export interface LLMCallParams {
  system: string;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
}

export async function callLLM(params: LLMCallParams): Promise<AnthropicResponse> {
  const provider = getActiveProvider();
  if (provider === "anthropic") return callAnthropic(params);
  return callOpenAICompat(compatTarget(provider), params);
}

export async function callLLMStream(
  params: LLMCallParams,
  handlers?: StreamHandlers,
): Promise<AnthropicResponse> {
  const provider = getActiveProvider();
  if (provider === "anthropic") return callAnthropicStream(params, handlers);
  return callOpenAICompatStream(compatTarget(provider), params, handlers);
}

// Re-export shared types so callers can import everything from "llm".
export type { AnthropicResponse, ContentBlock, Message, StreamHandlers, ToolDef } from "./anthropic";
