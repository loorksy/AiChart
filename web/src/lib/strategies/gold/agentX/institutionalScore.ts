/**
 * Gold Agent X — institutional composite TradeScore (0–100).
 */
import type { GoldAgentXConfig } from "../goldTypes";
import type {
  CouncilResult,
  InstitutionalScoreResult,
  MarketContext,
  MemoryStats,
  RegimeInfo,
  TradeQualityResult,
} from "./types";
import { DEFAULT_INSTITUTIONAL_WEIGHTS, clampScore } from "./types";
import { evaluateTimeframeAlignment } from "./timeframeAlignment";

export function computeInstitutionalScore(
  ctx: MarketContext,
  regime: RegimeInfo,
  council: CouncilResult,
  quality: TradeQualityResult,
  config: GoldAgentXConfig,
  memory?: MemoryStats,
): InstitutionalScoreResult {
  const w = { ...DEFAULT_INSTITUTIONAL_WEIGHTS, ...config.institutionalWeights };
  const align = evaluateTimeframeAlignment(ctx);

  const structure = clampScore(
    regime.probabilities.TRENDING_UP +
      regime.probabilities.TRENDING_DOWN +
      regime.probabilities.BREAKOUT * 0.5,
  );

  const momentum = clampScore(
    (ctx.indicators.M5.rsi14 ?? 50) +
      (ctx.indicators.M5.macd?.histogram ?? 0) * 10,
  );

  const liquidity = clampScore(
    50 +
      (ctx.structure.M5.nearestSupport ? 15 : 0) +
      (ctx.structure.M5.nearestResistance ? 15 : 0),
  );

  const session = clampScore(ctx.session.quality);
  const correlation = clampScore(
    ctx.correlation.dxy?.available || ctx.correlation.us10y?.available ? 65 : 50,
  );
  const volatility = clampScore(
    regime.probabilities.VOLATILE > 40 ? 35 : 70,
  );

  let memoryBoost = 50;
  if (memory?.regimeWins[regime.dominant]) {
    const wins = memory.regimeWins[regime.dominant] ?? 0;
    const losses = memory.regimeLosses[regime.dominant] ?? 0;
    const total = wins + losses;
    if (total >= 3) memoryBoost = clampScore((wins / total) * 100);
  }

  const consensus = clampScore(council.confidence);

  const components = {
    structure: structure * w.structure,
    momentum: momentum * w.momentum,
    liquidity: liquidity * w.liquidity,
    session: session * w.session,
    correlation: correlation * w.correlation,
    volatility: volatility * w.volatility,
    memory: memoryBoost * w.memory,
    consensus: consensus * w.consensus,
  };

  const weightSum =
    w.structure +
    w.momentum +
    w.liquidity +
    w.session +
    w.correlation +
    w.volatility +
    w.memory +
    w.consensus;

  const raw =
    (components.structure +
      components.momentum +
      components.liquidity +
      components.session +
      components.correlation +
      components.volatility +
      components.memory +
      components.consensus) /
    weightSum;

  const score = clampScore(raw * 0.7 + quality.score * 0.15 + align.score * 0.15);

  return {
    score,
    components: {
      structure,
      momentum,
      liquidity,
      session,
      correlation,
      volatility,
      memory: memoryBoost,
      consensus,
    },
  };
}
