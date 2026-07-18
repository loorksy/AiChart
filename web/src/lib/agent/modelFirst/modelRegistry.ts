/**
 * Canonical AiChart OpenAI model registry.
 *
 * Do NOT invent API model IDs. The allowlist is a review gate; runtime
 * availability comes from GET /v1/models + capability probes under the
 * configured API key. Only verified models appear in the user selector.
 */
import { z } from "zod";

export const REASONING_EFFORT_VALUES = [
  "high",
  "xhigh",
  "max",
  "medium",
  "low",
  "minimal",
  "none",
] as const;
export const ReasoningEffortSchema = z.enum(REASONING_EFFORT_VALUES);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export type ModelCostTier = "standard" | "premium" | "unknown";

/** Product-approved trading models, in selector/default priority order. */
export const AICART_APPROVED_MODEL_IDS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.5-pro",
] as const;

export type AiChartApprovedModelId = (typeof AICART_APPROVED_MODEL_IDS)[number];

const APPROVED_MODEL_SET = new Set<string>(AICART_APPROVED_MODEL_IDS);
const APPROVED_MODEL_PRIORITY = new Map<string, number>(
  AICART_APPROVED_MODEL_IDS.map((id, index) => [id, index]),
);

const APPROVED_DISPLAY_NAMES: Record<AiChartApprovedModelId, string> = {
  "gpt-5.6-sol": "GPT-5.6 Sol",
  "gpt-5.6-terra": "GPT-5.6 Terra",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.5-pro": "GPT-5.5 Pro",
};

export interface ModelCapabilityRecord {
  id: string;
  displayName: string;
  available: boolean;
  enabled: boolean;
  responsesApi: boolean;
  vision: boolean;
  structuredOutputs: boolean;
  reasoning: boolean;
  supportedReasoningValues: ReasoningEffort[];
  streaming: boolean;
  tools: boolean;
  contextTokens: number | null;
  deprecated: boolean;
  costTier: ModelCostTier;
  eligibleAsDefault: boolean;
  lastVerifiedAt: number | null;
  probeErrors: string[];
}

export const ModelCapabilityRecordSchema = z.object({
  id: z.string().min(1).max(120),
  displayName: z.string().min(1).max(160),
  available: z.boolean(),
  enabled: z.boolean(),
  responsesApi: z.boolean(),
  vision: z.boolean(),
  structuredOutputs: z.boolean(),
  reasoning: z.boolean(),
  supportedReasoningValues: z
    .array(ReasoningEffortSchema)
    .max(REASONING_EFFORT_VALUES.length),
  streaming: z.boolean(),
  tools: z.boolean(),
  contextTokens: z.number().int().positive().nullable(),
  deprecated: z.boolean(),
  costTier: z.enum(["standard", "premium", "unknown"]),
  eligibleAsDefault: z.boolean(),
  lastVerifiedAt: z.number().int().positive().nullable(),
  probeErrors: z.array(z.string().min(1).max(120)).max(32),
});

export interface PublicModelProjection {
  id: string;
  displayName: string;
  supportedReasoningValues: ReasoningEffort[];
  vision: boolean;
  eligibleAsDefault: boolean;
  reasoningAdjustable: boolean;
}

const EXCLUDE_PATTERNS: RegExp[] = [
  /embed/i,
  /whisper/i,
  /tts/i,
  /realtime/i,
  /moderation/i,
  /image/i,
  /dall-e/i,
  /audio/i,
  /transcrib/i,
  /search/i,
];

export function isAllowlistedModelId(id: string): boolean {
  const bare = id.replace(/^openai\//, "");
  if (EXCLUDE_PATTERNS.some((p) => p.test(bare))) return false;
  return APPROVED_MODEL_SET.has(bare);
}

export function compareApprovedModelIds(a: string, b: string): number {
  return (
    (APPROVED_MODEL_PRIORITY.get(a) ?? Number.MAX_SAFE_INTEGER) -
    (APPROVED_MODEL_PRIORITY.get(b) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function displayNameForModelId(id: string): string {
  const bare = id.replace(/^openai\//, "");
  if (isAllowlistedModelId(bare)) {
    return APPROVED_DISPLAY_NAMES[bare as AiChartApprovedModelId];
  }
  return bare
    .split("-")
    .map((part) => {
      if (/^\d/.test(part)) return part.toUpperCase();
      if (part.length <= 3) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function inferCostTier(id: string): ModelCostTier {
  const bare = id.toLowerCase();
  if (bare.includes("pro") || bare.includes("o3-pro")) return "premium";
  if (APPROVED_MODEL_SET.has(bare)) return "standard";
  if (bare.includes("mini") || bare.includes("nano")) return "standard";
  return "unknown";
}

export function eligibleAsDefaultFromCapabilities(
  record: Pick<
    ModelCapabilityRecord,
    | "available"
    | "enabled"
    | "responsesApi"
    | "vision"
    | "structuredOutputs"
    | "costTier"
    | "deprecated"
    | "supportedReasoningValues"
  >,
): boolean {
  if (!record.available || !record.enabled || record.deprecated) return false;
  if (!record.responsesApi || !record.vision || !record.structuredOutputs)
    return false;
  if (record.costTier === "premium") return false;
  return (
    record.supportedReasoningValues.includes("high") ||
    record.supportedReasoningValues.length === 0
  );
}

export function projectPublicModels(
  records: ModelCapabilityRecord[],
): PublicModelProjection[] {
  return [...records]
    .filter(
      (r) =>
        isAllowlistedModelId(r.id) &&
        r.available &&
        r.enabled &&
        r.responsesApi &&
        r.vision &&
        r.structuredOutputs,
    )
    .sort((a, b) => compareApprovedModelIds(a.id, b.id))
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      displayName: r.displayName,
      supportedReasoningValues: r.supportedReasoningValues,
      vision: r.vision,
      eligibleAsDefault: r.eligibleAsDefault,
      reasoningAdjustable: r.supportedReasoningValues.length > 1,
    }));
}

export function pickDefaultModelId(
  records: ModelCapabilityRecord[],
): string | null {
  const publics = projectPublicModels(records);
  const preferred = publics.find((m) => m.eligibleAsDefault);
  return preferred?.id ?? publics[0]?.id ?? null;
}

export function validateUserModelSelection(
  modelId: string,
  records: ModelCapabilityRecord[],
): { ok: true; record: ModelCapabilityRecord } | { ok: false; error: string } {
  const bare = modelId.replace(/^openai\//, "").trim();
  if (!bare || !isAllowlistedModelId(bare)) {
    return { ok: false, error: "model_not_allowed" };
  }
  const record = records.find((r) => r.id === bare);
  if (!record?.available || !record.enabled) {
    return { ok: false, error: "model_unavailable" };
  }
  if (!record.responsesApi || !record.vision || !record.structuredOutputs) {
    return { ok: false, error: "model_capabilities_insufficient" };
  }
  return { ok: true, record };
}

export function validateReasoningForModel(
  effort: string | undefined,
  record: ModelCapabilityRecord,
): { ok: true; effort: ReasoningEffort | null } | { ok: false; error: string } {
  if (!record.reasoning || record.supportedReasoningValues.length === 0) {
    return effort == null || effort === ""
      ? { ok: true, effort: null }
      : { ok: false, error: "reasoning_unsupported" };
  }
  if (effort != null && !ReasoningEffortSchema.safeParse(effort).success) {
    return { ok: false, error: "reasoning_unsupported" };
  }
  const preferred = effort
    ? (effort as ReasoningEffort)
    : record.supportedReasoningValues.includes("high")
      ? "high"
      : record.supportedReasoningValues[0]!;
  if (!record.supportedReasoningValues.includes(preferred)) {
    return { ok: false, error: "reasoning_unsupported" };
  }
  return { ok: true, effort: preferred };
}

/** In-memory cache of last probe results (process-local). */
let cachedRegistry: {
  at: number;
  records: ModelCapabilityRecord[];
} | null = null;

const CACHE_TTL_MS = 15 * 60 * 1000;

export function getCachedModelRegistry(): ModelCapabilityRecord[] | null {
  if (!cachedRegistry) return null;
  if (Date.now() - cachedRegistry.at > CACHE_TTL_MS) return null;
  return cachedRegistry.records;
}

export function setCachedModelRegistry(records: ModelCapabilityRecord[]): void {
  cachedRegistry = { at: Date.now(), records };
}

export function clearCachedModelRegistry(): void {
  cachedRegistry = null;
}
