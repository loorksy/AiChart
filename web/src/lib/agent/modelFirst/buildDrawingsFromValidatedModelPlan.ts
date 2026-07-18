/**
 * Convert a validated model trade plan into chart drawings.
 * Model-owned plan only — draw executable geometry only when technically ready.
 */
import type { FinalDecisionResult } from "../agents/finalDecisionAgent";
import type { DrawingPlan } from "../drawings/buildDrawingPlan";
import type { ValidatedTradePlan } from "./validatedTradePlan";

export function buildDrawingsFromValidatedModelPlan(input: {
  decision: FinalDecisionResult;
  validated?: ValidatedTradePlan | null;
  lastCandleTime?: number;
}): DrawingPlan {
  const rec = input.decision.recommendation;
  const validated = input.validated;
  const plan = validated?.plan;
  const time = input.lastCandleTime ?? Date.now();

  if (rec.action !== "buy" && rec.action !== "sell") {
    return {
      shouldDraw: false,
      reason: "قرار انتظار — لا تُرسم مستويات صفقة.",
      drawingIntent: "none",
      selectedLevels: [],
      selectedZones: [],
      selectedAnnotations: [],
    };
  }

  // Never fall back to raw/unvalidated model levels as executable geometry.
  if (!validated?.executionReady) {
    return {
      shouldDraw: false,
      reason:
        "الرأي الاتجاهي محفوظ، لكن المستويات غير صالحة تقنياً — يلزم تحديث المستويات.",
      drawingIntent: "none",
      selectedLevels: [],
      selectedZones: [],
      selectedAnnotations: [
        {
          type: "note",
          price: plan?.entryZone.preferred ?? rec.entryZone?.preferred ?? null,
          time,
          label: "Levels require refresh",
          strength: 40,
          direction:
            rec.action === "buy" ? ("bullish" as const) : ("bearish" as const),
        },
      ].filter((a) => a.price != null) as DrawingPlan["selectedAnnotations"],
    };
  }

  const entry = validated.entry;
  const stop = validated.stopLoss;
  const targets = validated.targets;
  const zoneLow = plan?.entryZone.low ?? entry;
  const zoneHigh = plan?.entryZone.high ?? entry;
  const invalidation = plan?.invalidation ?? rec.invalidationLevel ?? stop;

  if (entry == null || stop == null || targets.length === 0) {
    return {
      shouldDraw: false,
      reason:
        "الرأي الاتجاهي محفوظ، لكن لا توجد مستويات نموذج صالحة للرسم الآن.",
      drawingIntent: "none",
      selectedLevels: [],
      selectedZones: [],
      selectedAnnotations: [],
    };
  }

  const low =
    zoneLow != null && zoneHigh != null
      ? Math.min(zoneLow, zoneHigh)
      : entry;
  const high =
    zoneLow != null && zoneHigh != null
      ? Math.max(zoneLow, zoneHigh)
      : entry;

  const annotations =
    invalidation != null
      ? [
          {
            type: "invalidation" as const,
            price: invalidation,
            time,
            label:
              plan?.activation === "conditional" && plan.requiredConfirmation
                ? `إبطال · ${plan.requiredConfirmation.slice(0, 48)}`
                : "إبطال",
            strength: 80,
            direction:
              rec.action === "buy"
                ? ("bullish" as const)
                : ("bearish" as const),
          },
        ]
      : [];

  return {
    shouldDraw: true,
    reason: "مستويات من خطة النموذج المُتحققة تقنياً.",
    drawingIntent: "trade_setup",
    selectedLevels: [],
    selectedZones: [
      {
        type: rec.action === "buy" ? "demand" : "supply",
        low,
        high,
        time,
        strength: 85,
        reason: "منطقة دخول من خطة النموذج.",
      },
    ],
    selectedAnnotations: annotations,
    forecastPath: [
      { time, price: entry },
      { time: time + 60_000, price: targets[0]! },
    ],
  };
}
