/**
 * Complete-plan fragments for tests that create recommendations.
 *
 * The Complete Plan Contract refuses a buy/sell with missing layers, so a test
 * that only cares about, say, outcome accounting still has to create a plan a
 * real surface could have produced. These fragments are the shortest HONEST
 * completion — an immediate plan with real statements, not filler engineered
 * past the validator — so tests exercise the same write path production uses.
 */
import type { ActivationRule } from "@/lib/recommendations/activationRule";
import type { GateVerdict } from "@/lib/agent/gates/types";

/**
 * The shortest HONEST evidence card the factor-evidence check accepts: real
 * dimension shapes with at least one measurement, matching what the platform
 * evidence builder produces.
 */
export function completePlanEvidence(): Record<string, unknown> {
  return {
    evidenceDimensions: [
      {
        key: "signal_strength",
        grade: "moderate",
        detail: "قوة الإشارة الحالية 62%.",
        value: 62,
      },
      {
        key: "timeframe_agreement",
        grade: "strong",
        detail: "الفريمات متوافقة على الاتجاه.",
      },
    ],
  };
}

/**
 * Record a fully-passed gate chain for (userId, analysisId) through the REAL
 * recorder, so tests exercise the same write authorization production uses.
 */
export async function seedPassedGateChain(
  userId: number,
  analysisId: string,
  symbol = "XAUUSD",
): Promise<void> {
  const { recordGateChain } = await import("@/lib/recommendations/gateRecords");
  const now = Date.now();
  const verdict = (id: GateVerdict["id"], name: string): GateVerdict => ({
    id,
    name,
    status: "pass",
    evidence: { fixture: true },
    startedAt: now - 500,
    finishedAt: now,
  });
  await recordGateChain({
    userId,
    analysisId,
    symbol,
    chainAllowed: true,
    verdicts: [
      verdict("G1", "news_and_events"),
      verdict("G2", "liquidity_map"),
      verdict("G3", "supply_demand"),
      verdict("G4", "structure_and_bias"),
      verdict("G6", "risk_geometry"),
      verdict("G7", "live_revalidation"),
    ],
  });
}

let gatedSequence = 0;

/**
 * A complete plan WITH its write authorization: seeds a passed gate chain
 * under a fresh analysis id and returns the spreadable create input carrying
 * that id and a sourced evidence card. The one-line way for a test to create
 * a plan the Phase-4 write boundary accepts.
 */
export async function gatedCompletePlan(
  userId: number,
  overrides?: Parameters<typeof canonicalCompletePlan>[0] & {
    analysisId?: string;
    symbol?: string;
  },
): Promise<ReturnType<typeof canonicalCompletePlan> & { analysisId: string }> {
  const analysisId =
    overrides?.analysisId ?? `fixture-analysis-${Date.now()}-${++gatedSequence}`;
  await seedPassedGateChain(userId, analysisId, overrides?.symbol ?? "XAUUSD");
  return {
    ...canonicalCompletePlan({
      evidence: completePlanEvidence(),
      ...overrides,
    }),
    analysisId,
  };
}

/** Spread into `CreateCanonicalRecommendationInput`. */
export function canonicalCompletePlan(overrides?: {
  planType?: "immediate" | "anticipatory" | "conditional";
  executionState?: string;
  activationCondition?: string | null;
  activationRule?: ActivationRule | null;
  evidence?: Record<string, unknown> | null;
  evidenceSnapshot?: Record<string, unknown> | null;
  decisionTrace?: Record<string, unknown> | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  validityCandles?: number;
}) {
  const planType = overrides?.planType ?? "immediate";
  const conditional = planType !== "immediate";
  return {
    planType,
    executionState:
      overrides?.executionState ?? (conditional ? "awaiting_activation" : "valid_now"),
    initialRevision: {
      entryLow: overrides?.entryLow ?? null,
      entryHigh: overrides?.entryHigh ?? null,
      activationCondition:
        overrides?.activationCondition ??
        (conditional ? "إغلاق شمعة على الإطار المعتمد خلف مستوى الخطة" : null),
      activationRule:
        overrides?.activationRule ??
        (conditional
          ? ({
              kind: "candle_close_above",
              level: 1,
              timeframe: "1h",
            } satisfies ActivationRule)
          : null),
      invalidationRule: "إغلاق شمعة كاملة خلف وقف الخسارة يلغي فكرة الخطة",
      alternativeScenario: "فشل الحركة يعكس الانحياز نحو الطرف الآخر من النطاق",
      validityCandles: overrides?.validityCandles ?? 24,
      evidence: overrides?.evidence ?? completePlanEvidence(),
      evidenceSnapshot: overrides?.evidenceSnapshot ?? null,
      decisionTrace: overrides?.decisionTrace ?? null,
    },
  };
}

/**
 * A tracked-store plan WITH its write authorization: seeds a passed gate
 * chain and returns spreadable `CreateTrackedRecommendationInput` fields
 * carrying the analysis id and a sourced evidence card.
 */
export async function gatedTrackedPlan(
  userId: number,
  overrides?: Parameters<typeof trackedCompletePlan>[0] & {
    analysisId?: string;
    symbol?: string;
  },
): Promise<
  ReturnType<typeof trackedCompletePlan> & {
    analysisId: string;
    evidence: Record<string, unknown>;
  }
> {
  const analysisId =
    overrides?.analysisId ?? `fixture-analysis-${Date.now()}-${++gatedSequence}`;
  await seedPassedGateChain(userId, analysisId, overrides?.symbol ?? "XAUUSD");
  return {
    ...trackedCompletePlan(overrides),
    analysisId,
    evidence: completePlanEvidence(),
  };
}

/** Spread into `CreateTrackedRecommendationInput` (top-level field names). */
export function trackedCompletePlan(overrides?: {
  planType?: "immediate" | "anticipatory" | "conditional";
  executionState?:
    | "valid_now"
    | "awaiting_activation"
    | "expired"
    | "invalidated"
    | "blocked";
}) {
  const planType = overrides?.planType ?? "immediate";
  const conditional = planType !== "immediate";
  return {
    planType,
    executionState:
      overrides?.executionState ?? (conditional ? ("awaiting_activation" as const) : ("valid_now" as const)),
    ...(conditional
      ? {
          triggerCondition: "إغلاق شمعة على الإطار المعتمد خلف مستوى الخطة",
          activationRule: {
            kind: "candle_close_above",
            level: 1,
            timeframe: "1h",
          } satisfies ActivationRule,
        }
      : {}),
    invalidationRule: "إغلاق شمعة كاملة خلف وقف الخسارة يلغي فكرة الخطة",
    alternativeScenario: "فشل الحركة يعكس الانحياز نحو الطرف الآخر من النطاق",
    validityCandles: 24,
  };
}

/** Spread into the `saveRecommendation` payload (snake_case field names). */
export function saveCompletePlan(overrides?: {
  plan_type?: "immediate" | "anticipatory" | "conditional";
}) {
  const planType = overrides?.plan_type ?? "immediate";
  const conditional = planType !== "immediate";
  return {
    plan_type: planType,
    ...(conditional
      ? {
          activation_condition: "إغلاق شمعة على الإطار المعتمد خلف مستوى الخطة",
          activation_rule: {
            kind: "candle_close_above",
            level: 1,
            timeframe: "1h",
          } satisfies ActivationRule,
        }
      : {}),
    invalidation_rule: "إغلاق شمعة كاملة خلف وقف الخسارة يلغي فكرة الخطة",
    alternative_scenario: "فشل الحركة يعكس الانحياز نحو الطرف الآخر من النطاق",
    validity_candles: 24,
  };
}
