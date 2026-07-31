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
      evidence: overrides?.evidence ?? null,
      evidenceSnapshot: overrides?.evidenceSnapshot ?? null,
      decisionTrace: overrides?.decisionTrace ?? null,
    },
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
