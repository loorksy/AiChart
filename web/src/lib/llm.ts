/**
 * Unified LLM layer: routes chat calls to the provider selected in the admin
 * panel (AI_PROVIDER): anthropic | openai | google (Gemini).
 */

import {
  callAnthropic,
  callAnthropicStream,
  getAnthropicModel,
  type AnthropicResponse,
  type Message,
  type StreamHandlers,
  type SystemPromptInput,
  type ToolDef,
} from "./anthropic";
import { GEMINI_OPENAI_BASE_URL, normalizeGeminiChatModel } from "./gemini";
import {
  callOpenAICompat,
  callOpenAICompatStream,
  type OpenAICompatTarget,
} from "./openaiCompat";
import { getPlatformValue } from "./platformConfig";

export type LLMProvider = "anthropic" | "openai" | "google";

export const LLM_PROVIDERS: { id: LLMProvider; label: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google (Gemini)" },
];

const PROVIDER_KEY_FIELD: Record<LLMProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
};

const DEFAULT_MODEL: Record<LLMProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4.1",
  google: "gemini-2.5-flash",
};

export function getActiveProvider(): LLMProvider {
  const raw = (getPlatformValue("AI_PROVIDER") || "anthropic").toLowerCase();
  if (raw === "google" || raw === "gemini" || raw === "openrouter") return "google";
  if (raw === "openai") return "openai";
  return "anthropic";
}

/** Active model for the active provider (AI_MODEL, with legacy fallback). */
export function getActiveModel(): string {
  const provider = getActiveProvider();
  const model = getPlatformValue("AI_MODEL");
  if (model) {
    if (provider === "google") return normalizeGeminiChatModel(model);
    return model;
  }
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

type CompatProvider = "openai" | "google";

function compatModelId(provider: CompatProvider, model: string): string {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

function compatTarget(provider: CompatProvider): OpenAICompatTarget {
  const apiKey = getProviderApiKey(provider);
  if (!apiKey) {
    const msg: Record<CompatProvider, string> = {
      openai: "مفتاح OpenAI غير مُعدّ. أضِفه من لوحة المفاتيح.",
      google: "مفتاح Gemini غير مُعدّ. أضِف GEMINI_API_KEY من لوحة المفاتيح.",
    };
    throw new Error(msg[provider]);
  }
  const model = compatModelId(provider, getActiveModel());
  if (provider === "google") {
    return {
      baseUrl: GEMINI_OPENAI_BASE_URL,
      apiKey,
      model,
    };
  }
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey,
    model,
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
  const provider = getActiveProvider();
  if (provider === "anthropic") return callAnthropic(params);
  return callOpenAICompat(compatTarget(provider as CompatProvider), {
    ...params,
    system: flattenSystem(params.system),
  });
}

export async function callLLMStream(
  params: LLMCallParams,
  handlers?: StreamHandlers,
): Promise<AnthropicResponse> {
  const provider = getActiveProvider();
  if (provider === "anthropic") return callAnthropicStream(params, handlers);
  return callOpenAICompatStream(
    compatTarget(provider as CompatProvider),
    { ...params, system: flattenSystem(params.system) },
    handlers,
  );
}

export type { AnthropicResponse, ContentBlock, Message, StreamHandlers, ToolDef } from "./anthropic";
