import { GEMINI_OPENAI_BASE_URL, isGeminiStudioApiKey } from "./gemini";
import {
  getActiveModel,
  getActiveProvider,
  getProviderApiKey,
  type LLMProvider,
} from "./llm";

export function modelRefFromPlatform(model?: string): string {
  const provider = getActiveProvider();
  const id = (model ?? getActiveModel()).trim();
  return id.startsWith(`${provider}/`) ? id : `${provider}/${id}`;
}

const CROSS_FALLBACK_CANDIDATES: Partial<Record<LLMProvider, string>> = {
  openai: "openai/gpt-4.1-mini",
  google: "google/gemini-2.5-flash",
};

const SAME_PROVIDER_ALT: Partial<Record<LLMProvider, string>> = {
  google: "google/gemini-2.0-flash",
};

const FALLBACK_PROVIDER_ORDER: LLMProvider[] = ["openai", "google"];
const SYNC_PROVIDERS: LLMProvider[] = ["anthropic", "openai", "google"];

function isAllowedModelRef(ref: string): boolean {
  const lower = ref.toLowerCase();
  if (lower.includes("openrouter")) return false;
  if (lower.includes("-tts")) return false;
  const provider = providerKeyFromRef(ref);
  return SYNC_PROVIDERS.includes(provider as LLMProvider);
}

function providerKeyConfigured(provider: LLMProvider): boolean {
  const key = getProviderApiKey(provider);
  if (!key?.trim()) return false;
  if (provider === "google") return isGeminiStudioApiKey(key);
  return true;
}

export function buildFallbackRefs(primaryRef: string): string[] {
  const primaryProvider = providerKeyFromRef(primaryRef) as LLMProvider;
  const out: string[] = [];

  const sameAlt = SAME_PROVIDER_ALT[primaryProvider];
  if (
    sameAlt &&
    sameAlt.toLowerCase() !== primaryRef.toLowerCase() &&
    providerKeyConfigured(primaryProvider) &&
    isAllowedModelRef(sameAlt)
  ) {
    out.push(sameAlt);
  }

  for (const provider of FALLBACK_PROVIDER_ORDER) {
    if (provider === primaryProvider) continue;
    if (!providerKeyConfigured(provider)) continue;
    const candidate = CROSS_FALLBACK_CANDIDATES[provider];
    if (!candidate || !isAllowedModelRef(candidate)) continue;
    if (candidate.toLowerCase() === primaryRef.toLowerCase()) continue;
    if (out.some((r) => r.toLowerCase() === candidate.toLowerCase())) continue;
    out.push(candidate);
  }
  return out;
}

export function modelIdFromRef(ref: string): string {
  const slash = ref.indexOf("/");
  return slash >= 0 ? ref.slice(slash + 1) : ref;
}

export function providerKeyFromRef(ref: string): string {
  const slash = ref.indexOf("/");
  return slash >= 0 ? ref.slice(0, slash) : "anthropic";
}

export type AgentModelStatus = {
  channel: "mcp";
  platformModel: string;
  platformRef: string;
  fallbacks: string[];
};

export function getAgentModelStatus(): AgentModelStatus {
  const platformModel = getActiveModel();
  const platformRef = modelRefFromPlatform(platformModel);
  return {
    channel: "mcp",
    platformModel,
    platformRef,
    fallbacks: buildFallbackRefs(platformRef),
  };
}

/** Provider base URLs for OpenAI-compatible APIs (platform / MCP context). */
export const PROVIDER_BASE_URL: Partial<Record<LLMProvider | "google", string>> =
  {
    openai: "https://api.openai.com/v1",
    google: GEMINI_OPENAI_BASE_URL,
  };
