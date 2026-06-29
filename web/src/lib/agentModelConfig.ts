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

// OpenAI-internal fallback: drop to a cheaper/faster OpenAI model on failure.
const SAME_PROVIDER_ALT: Partial<Record<LLMProvider, string>> = {
  openai: "openai/gpt-4.1-mini",
};

const SYNC_PROVIDERS: LLMProvider[] = ["openai"];

function isAllowedModelRef(ref: string): boolean {
  const lower = ref.toLowerCase();
  if (lower.includes("-tts")) return false;
  const provider = providerKeyFromRef(ref);
  return SYNC_PROVIDERS.includes(provider as LLMProvider);
}

function providerKeyConfigured(provider: LLMProvider): boolean {
  return Boolean(getProviderApiKey(provider)?.trim());
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
  return out;
}

export function modelIdFromRef(ref: string): string {
  const slash = ref.indexOf("/");
  return slash >= 0 ? ref.slice(slash + 1) : ref;
}

export function providerKeyFromRef(ref: string): string {
  const slash = ref.indexOf("/");
  return slash >= 0 ? ref.slice(0, slash) : "openai";
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
export const PROVIDER_BASE_URL: Partial<Record<LLMProvider, string>> = {
  openai: "https://api.openai.com/v1",
};
