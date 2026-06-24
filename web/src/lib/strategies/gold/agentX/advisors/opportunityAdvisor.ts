/**
 * Opportunity Advisor — confluence boost only.
 */
import type { AdvisorVote, MarketContext, RegimeInfo } from "../types";
import { clampScore } from "../types";
import { evaluateTimeframeAlignment } from "../timeframeAlignment";

export function runOpportunityAdvisor(ctx: MarketContext, regime: RegimeInfo): AdvisorVote {
  const alignment = evaluateTimeframeAlignment(ctx);
  const m5 = ctx.indicators.M5;
  const s15 = ctx.structure.M15;

  let confluence = 0;
  if (alignment.aligned) confluence += 25;
  if (regime.confidence >= 65) confluence += 15;
  if (s15.nearestSupport && ctx.quote.mid - s15.nearestSupport < (m5.atr14 ?? 3)) {
    confluence += 10;
  }
  if (s15.nearestResistance && s15.nearestResistance - ctx.quote.mid < (m5.atr14 ?? 3)) {
    confluence += 10;
  }

  if (confluence < 30) {
    return {
      advisor: "opportunity",
      vote: "hold",
      confidence: 45,
      reason: "لا توافق كافٍ للفرصة",
    };
  }

  const vote = alignment.direction === "neutral" ? "hold" : alignment.direction;

  return {
    advisor: "opportunity",
    vote,
    confidence: clampScore(50 + confluence),
    reason: `توافق ${confluence}% — ${alignment.summary}`,
  };
}
