/**
 * Gold Agent X — advisor council aggregation.
 */
import { runCandleAdvisor } from "./advisors/candleAdvisor";
import { runCorrelationAdvisor } from "./advisors/correlationAdvisor";
import { runFearAdvisor } from "./advisors/fearAdvisor";
import { runLiquidityAdvisor } from "./advisors/liquidityAdvisor";
import { runMomentumAdvisor } from "./advisors/momentumAdvisor";
import { runOpportunityAdvisor } from "./advisors/opportunityAdvisor";
import { runSessionAdvisor } from "./advisors/sessionAdvisor";
import { runSmartMoneyAdvisor } from "./advisors/smartMoneyAdvisor";
import { runTrendAdvisor } from "./advisors/trendAdvisor";
import { runVolatilityAdvisor } from "./advisors/volatilityAdvisor";
import { applyAdaptiveWeights } from "./adaptiveWeights";
import type {
  AdvisorVote,
  CouncilResult,
  MarketContext,
  RegimeInfo,
} from "./types";
import { clampScore } from "./types";

export function runCouncil(
  ctx: MarketContext,
  regime: RegimeInfo,
  weights: Record<string, number>,
): CouncilResult {
  const raw: AdvisorVote[] = [
    runTrendAdvisor(ctx, regime),
    runCandleAdvisor(ctx, regime),
    runMomentumAdvisor(ctx, regime),
    runVolatilityAdvisor(ctx, regime),
    runFearAdvisor(ctx, regime),
    runOpportunityAdvisor(ctx, regime),
    runSmartMoneyAdvisor(ctx, regime),
    runLiquidityAdvisor(ctx, regime),
    runSessionAdvisor(ctx, regime),
    runCorrelationAdvisor(ctx, regime),
  ];

  const votes = applyAdaptiveWeights(raw, weights);

  let buyWeight = 0;
  let sellWeight = 0;
  let holdWeight = 0;

  for (const v of votes) {
    const w = weights[v.advisor] ?? 1;
    const power = v.confidence * w;
    if (v.vote === "buy") buyWeight += power;
    else if (v.vote === "sell") sellWeight += power;
    else holdWeight += power * 0.5;
  }

  const total = buyWeight + sellWeight + holdWeight || 1;
  let consensusSide: AdvisorVote["vote"] = "hold";
  if (buyWeight > sellWeight && buyWeight > holdWeight) consensusSide = "buy";
  else if (sellWeight > buyWeight && sellWeight > holdWeight) consensusSide = "sell";

  const winning = Math.max(buyWeight, sellWeight, holdWeight);
  const confidence = clampScore((winning / total) * 100);

  return {
    votes,
    consensusSide,
    confidence,
    buyWeight,
    sellWeight,
    holdWeight,
  };
}
