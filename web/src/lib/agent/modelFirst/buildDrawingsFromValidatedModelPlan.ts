/**
 * Convert a validated model trade plan into chart drawings.
 * Model-owned plan only — no pre-model trade proposal authority.
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
  const plan = input.validated?.plan;
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

  const zoneLow =
    plan?.entryZone.low ??
    rec.entryZone?.low ??
    (rec.entry != null ? rec.entry : null);
  const zoneHigh =
    plan?.entryZone.high ??
    rec.entryZone?.high ??
    (rec.entry != null ? rec.entry : null);
  const entry =
    input.validated?.executionReady
      ? input.validated.entry
      : (rec.entry ?? plan?.entryZone.preferred ?? null);
  const stop =
    input.validated?.executionReady
      ? input.validated.stopLoss
      : (rec.stop_loss ?? plan?.stopLoss ?? null);
  const targets =
    input.validated?.executionReady
      ? input.validated.targets
      : (rec.targets ?? plan?.targets.map((t) => t.price) ?? []);
  const invalidation =
    rec.invalidationLevel ?? plan?.invalidation ?? stop;

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
            label: "إبطال",
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
