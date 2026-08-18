/**
 * The models this platform actually offers — a closed list, not the provider's.
 *
 * An API key can call far more models than the platform has vetted (previews,
 * deprecated ids, mini/nano tiers with different behavior). The user-facing
 * picker and the saved preference are both restricted to this catalogue: the
 * admin supplies the key, the user picks from the models we committed to.
 *
 * A LEAF module by the same rule as thresholds.ts: no imports, so client code
 * (the composer picker) can share it without dragging the DB into the bundle.
 */

export interface ModelChoice {
  id: string;
  label: string;
}

/** Exactly three multimodal (text+vision) OpenAI models. The user picks; the
 *  admin only supplies the key. */
export const OPENAI_MODEL_CHOICES: ModelChoice[] = [
  { id: "gpt-5.6-luna-pro", label: "GPT-5.6 Luna Pro" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-4.1", label: "GPT-4.1" },
];

/** Exactly three multimodal Claude models, mirroring the OpenAI trio. */
export const ANTHROPIC_MODEL_CHOICES: ModelChoice[] = [
  { id: "claude-fable-5", label: "Claude Fable 5" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
];

// OpenRouter has NO static catalogue on purpose: the admin pastes a key and
// every FREE route on openrouter.ai is offered automatically (see
// listOpenRouterFreeModels + the live-gateway branch of isOfferedModelRef).
// A hardcoded list here would go stale the day OpenRouter rotates its free
// tier, and a paid route sneaking in would bill the operator silently.

/** TokenRouter is a closed catalogue: one DeepSeek V4 Pro free route. */
export const DEFAULT_TOKENROUTER_MODEL =
  "deepseek/deepseek-v4-pro-0813-free";

export const TOKENROUTER_MODEL_CHOICES: ModelChoice[] = [
  { id: DEFAULT_TOKENROUTER_MODEL, label: "DeepSeek V4 Pro" },
];

const ALLOWED_REFS = new Set<string>([
  ...OPENAI_MODEL_CHOICES.map((m) => `openai/${m.id}`),
  ...ANTHROPIC_MODEL_CHOICES.map((m) => `anthropic/${m.id}`),
  ...TOKENROUTER_MODEL_CHOICES.map((m) => `tokenrouter/${m.id}`),
]);

/** Is this "provider/model" ref one the platform offers? */
export function isAllowedModelRef(ref: string): boolean {
  return ALLOWED_REFS.has(ref);
}

/**
 * Composer-facing label: the model name only, not the company that ships it.
 * "Claude Fable 5" → "Fable 5", "OpenAI: GPT-4o Mini" → "GPT-4o Mini".
 * Admin catalogues keep the full string; the picker already shows a provider icon.
 */
export function shortModelLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return trimmed;
  const stripped = trimmed
    .replace(
      /^(OpenAI|Anthropic|Google|Meta|Mistral|DeepSeek|xAI|Qwen|OpenRouter|Amazon|Microsoft|Cohere|Perplexity)\s*[:·|-]\s*/i,
      "",
    )
    .replace(/^(Claude|OpenAI|Anthropic|DeepSeek)\s+/i, "")
    .trim();
  return stripped || trimmed;
}

/**
 * o-series, gpt-5, and DeepSeek V4 models "think" before answering — reasoning tokens
 * spend wall-clock time and completion budget before the visible answer
 * starts, the same way Claude 5-family extended thinking does. Callers that
 * size a completion-token cap or a stage deadline for a fast/non-reasoning
 * model must widen it for these ids, or a heavy pick (e.g. gpt-5.6-luna-pro)
 * truncates its own JSON output and forces a retry that a tight shared
 * deadline can't fit twice.
 */
export function isReasoningModel(model: string): boolean {
  const id = model.trim().toLowerCase().split("/").pop() ?? "";
  return /^o\d/.test(id) || /^gpt-5/.test(id) || /^deepseek-v4/.test(id);
}
