/**
 * Durable model-plan persistence envelope (context_json).
 * No Trade Candidate ID. Backward-safe: historical rows without this shape remain readable.
 */
import type { ModelTradePlan } from "./modelTradePlan";
import type { ValidatedTradePlan } from "./validatedTradePlan";

export const MODEL_PLAN_CONTEXT_VERSION = 1 as const;

export type ModelPlanPersistence = {
  version: typeof MODEL_PLAN_CONTEXT_VERSION;
  kind: "model_owned_plan";
  decision: ModelTradePlan["decision"];
  activation: ModelTradePlan["activation"];
  marketRegime: ModelTradePlan["marketRegime"];
  marketThesis: string;
  entryZone: ModelTradePlan["entryZone"];
  preferredEntry: number | null;
  invalidation: number | null;
  stopLoss: number | null;
  targets: ModelTradePlan["targets"];
  requiredConfirmation: string | null;
  pathToEntry: string | null;
  alternativeScenario: string;
  confidence: number;
  modelId: string | null;
  reasoningEffort: string | null;
  snapshotId: string | null;
  snapshotFingerprint: string | null;
  quoteSource: string | null;
  quoteTimestamp: number | null;
  quoteAgeMs: number | null;
  primaryTimeframe: string;
  contextTimeframes: string[];
  timeframeAnalysis: ModelTradePlan["timeframeAnalysis"];
  validationState: "accepted" | "rejected" | "not_applicable";
  validationErrors: string[];
  executionReadiness: string;
  repairAttempted: boolean;
  repairResult: "improved" | "unchanged" | "failed" | "not_attempted";
  safeProvenance: {
    source: "unified_platform_agent" | "mcp_host_model" | "historical_compat";
    engineVersion: string;
    persistedAt: number;
  };
  /** Executable levels only when technically accepted; null otherwise. */
  executableLevels: {
    entry: number | null;
    stopLoss: number | null;
    targets: number[];
  } | null;
};

export function buildModelPlanPersistence(input: {
  plan: ModelTradePlan;
  validated: ValidatedTradePlan | null;
  modelId?: string | null;
  reasoningEffort?: string | null;
  snapshotId?: string | null;
  snapshotFingerprint?: string | null;
  quoteSource?: string | null;
  quoteTimestamp?: number | null;
  quoteAgeMs?: number | null;
  repairAttempted?: boolean;
  repairImproved?: boolean;
  executionReadiness?: string;
  source?: ModelPlanPersistence["safeProvenance"]["source"];
}): ModelPlanPersistence {
  const plan = input.plan;
  const validated = input.validated;
  const executionReady = Boolean(validated?.executionReady);
  const validationState: ModelPlanPersistence["validationState"] =
    plan.decision === "wait"
      ? "not_applicable"
      : executionReady
        ? "accepted"
        : "rejected";
  const repairAttempted = Boolean(input.repairAttempted);
  const repairResult: ModelPlanPersistence["repairResult"] = !repairAttempted
    ? "not_attempted"
    : input.repairImproved
      ? "improved"
      : executionReady
        ? "improved"
        : "failed";

  return {
    version: MODEL_PLAN_CONTEXT_VERSION,
    kind: "model_owned_plan",
    decision: plan.decision,
    activation: plan.activation,
    marketRegime: plan.marketRegime,
    marketThesis: plan.marketThesis,
    entryZone: plan.entryZone,
    preferredEntry: plan.entryZone.preferred,
    invalidation: plan.invalidation,
    stopLoss: plan.stopLoss,
    targets: plan.targets,
    requiredConfirmation: plan.requiredConfirmation,
    pathToEntry: plan.pathToEntry,
    alternativeScenario: plan.alternativeScenario,
    confidence: plan.confidence,
    modelId: input.modelId ?? null,
    reasoningEffort: input.reasoningEffort ?? null,
    snapshotId: input.snapshotId ?? null,
    snapshotFingerprint: input.snapshotFingerprint ?? null,
    quoteSource: input.quoteSource ?? null,
    quoteTimestamp: input.quoteTimestamp ?? null,
    quoteAgeMs: input.quoteAgeMs ?? null,
    primaryTimeframe: plan.primaryTimeframe,
    contextTimeframes: plan.contextTimeframes,
    timeframeAnalysis: plan.timeframeAnalysis,
    validationState,
    validationErrors: validated?.technicalErrors ?? [],
    executionReadiness:
      input.executionReadiness ??
      (plan.decision === "wait"
        ? "none"
        : executionReady
          ? "ready_for_approval"
          : "levels_require_refresh"),
    repairAttempted,
    repairResult,
    safeProvenance: {
      source: input.source ?? "unified_platform_agent",
      engineVersion: "aichart-model-plan-v1",
      persistedAt: Date.now(),
    },
    executableLevels: executionReady
      ? {
          entry: validated?.entry ?? null,
          stopLoss: validated?.stopLoss ?? null,
          targets: validated?.targets ?? [],
        }
      : null,
  };
}

export function serializeModelPlanPersistence(
  persistence: ModelPlanPersistence,
): string {
  return JSON.stringify(persistence);
}

/**
 * Read-only historical compatibility mapper.
 * Old Candidate-backed / flat rows remain readable without Trade Candidate IDs.
 */
export function mapHistoricalRecommendationContext(input: {
  contextJson?: string | null;
  riskJson?: string | null | Record<string, unknown>;
  action?: string | null;
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  targets?: number[] | null;
  confidence?: number | null;
  rationale?: string | null;
}): {
  kind: "model_owned_plan" | "historical_compat";
  modelPlan: ModelPlanPersistence | null;
  display: {
    decision: string;
    entry: number | null;
    stopLoss: number | null;
    targets: number[];
    confidence: number | null;
    summary: string | null;
    hasPoiScoreCompat: boolean;
  };
} {
  const parsed = parseModelPlanContext(input.contextJson);
  if (parsed) {
    return {
      kind: "model_owned_plan",
      modelPlan: parsed,
      display: {
        decision: parsed.decision,
        entry: parsed.executableLevels?.entry ?? parsed.preferredEntry,
        stopLoss: parsed.executableLevels?.stopLoss ?? parsed.stopLoss,
        targets:
          parsed.executableLevels?.targets ??
          parsed.targets.map((t) => t.price),
        confidence: parsed.confidence,
        summary: parsed.marketThesis,
        hasPoiScoreCompat: false,
      },
    };
  }

  const risk =
    typeof input.riskJson === "string"
      ? safeJson(input.riskJson)
      : (input.riskJson ?? {});
  const poi =
    risk && typeof risk === "object" && "poi" in risk
      ? (risk as { poi?: { score?: unknown } }).poi
      : undefined;
  const hasPoiScoreCompat =
    poi != null && typeof poi.score === "number";

  return {
    kind: "historical_compat",
    modelPlan: null,
    display: {
      decision: input.action ?? "wait",
      entry: input.entry ?? null,
      stopLoss: input.stopLoss ?? null,
      targets:
        input.targets?.length
          ? input.targets
          : input.takeProfit != null
            ? [input.takeProfit]
            : [],
      confidence:
        typeof input.confidence === "number" ? input.confidence : null,
      summary: input.rationale ?? null,
      hasPoiScoreCompat,
    },
  };
}

export function parseModelPlanContext(
  contextJson?: string | null,
): ModelPlanPersistence | null {
  if (!contextJson) return null;
  const value = safeJson(contextJson);
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (obj.kind !== "model_owned_plan") return null;
  if (obj.version !== MODEL_PLAN_CONTEXT_VERSION) return null;
  return obj as unknown as ModelPlanPersistence;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
