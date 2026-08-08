import type { ChartDrawing } from "@/lib/chartDrawings";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import { proposeStructuralTrendline } from "./trendlineEvidence";

/**
 * Structural trendline drawing. Uses the warehouse analytical history — never
 * the short chart viewport alone — and refuses tiny local zigzags.
 */
export function buildTrendlineDrawing(
  market: AgentMarketContext,
): ChartDrawing[] {
  // Prefer full analytical history. Viewport-only history is never enough for
  // a structural line; require drawing-gate coverage first.
  if (!market.dataQuality.coverage?.sufficientForDrawing) {
    return [];
  }

  const candles = market.currentTfCandles;
  if (candles.length < 40) return [];

  const proposal = proposeStructuralTrendline({
    candles,
    timeframe: market.interval,
    atr: market.atr,
  });
  if (!proposal.accepted) return [];

  const { evidence } = proposal;
  const color = evidence.direction === "support" ? "#22c55e" : "#ef4444";
  const label =
    evidence.direction === "support"
      ? "خط اتجاه هيكلي (دعم)"
      : "خط اتجاه هيكلي (مقاومة)";

  return [
    {
      type: "trend_line",
      confidence: evidence.evidenceScore,
      label,
      color,
      semanticRole: "trendline",
      points: evidence.anchors.map((a) => ({
        time: a.time,
        price: a.price,
      })),
      meta: {
        drawingCommand: "draw_trendline",
        drawingClass: "structural_trendline",
        evidence: {
          policyVersion: evidence.policyVersion,
          direction: evidence.direction,
          candleSeparation: evidence.candleSeparation,
          independentTouches: evidence.independentTouches,
          atrNormalizedDistance: evidence.atrNormalizedDistance,
          evidenceScore: evidence.evidenceScore,
          sourceDetector: evidence.sourceDetector,
          reason: evidence.reason,
        },
      },
    },
  ];
}
