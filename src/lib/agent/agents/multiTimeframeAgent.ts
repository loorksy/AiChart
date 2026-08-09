import type { AgentRunContext } from "../types";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import { biasFromCandles, type Bias } from "../marketContext/detectors";

export interface MultiTimeframeResult {
  currentBias: Bias;
  higherBias: Bias;
  dailyBias: Bias;
  conflict: boolean;
}

/** Compares current-TF bias against the higher TF + daily for HTF conflict. */
export async function runMultiTimeframeAgent(
  ctx: AgentRunContext,
  market: AgentMarketContext,
): Promise<MultiTimeframeResult> {
  ctx.emitActivity({
    type: "analysis",
    status: "started",
    message: `أقارن فريم ${market.interval} مع الفريم الأعلى ${market.higherInterval}.`,
    // Narration-only: trace log, not UI. The comparison result event follows.
    visible: false,
  });

  const currentBias = biasFromCandles(market.currentTfCandles);
  const higherBias = biasFromCandles(market.higherTfCandles);
  const dailyBias = biasFromCandles(market.dailyCandles);

  const conflict =
    currentBias !== "unknown" &&
    higherBias !== "unknown" &&
    currentBias !== "neutral" &&
    higherBias !== "neutral" &&
    currentBias !== higherBias;

  ctx.emitActivity({
    type: "analysis",
    status: conflict ? "warning" : "completed",
    message: conflict
      ? "يوجد تعارض بين الفريم الحالي والفريم الأعلى."
      : "قارنت الفريمات دون تعارض قوي.",
    metadata: { currentBias, higherBias, dailyBias, conflict },
  });

  return { currentBias, higherBias, dailyBias, conflict };
}
