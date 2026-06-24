/**
 * Gold Agent X — probabilistic market state engine (sum = 100%).
 */
import type { MarketContext, MarketRegime, RegimeInfo, RegimeProbabilities } from "./types";
import { MARKET_REGIMES, clampScore, emptyRegimeProbabilities } from "./types";

function softmax(scores: Record<MarketRegime, number>): RegimeProbabilities {
  const keys = MARKET_REGIMES;
  const max = Math.max(...keys.map((k) => scores[k]));
  const exps = keys.map((k) => Math.exp(scores[k] - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = emptyRegimeProbabilities();
  keys.forEach((k, i) => {
    probs[k] = Math.round((exps[i]! / sum) * 100);
  });
  const total = keys.reduce((s, k) => s + probs[k], 0);
  if (total !== 100) {
    const dominant = keys.reduce(
      (best, k) => (probs[k] > probs[best] ? k : best),
      keys[0]!,
    );
    probs[dominant] += 100 - total;
  }
  return probs;
}

export function computeRegimeProbabilities(ctx: MarketContext): RegimeProbabilities {
  const m5 = ctx.indicators.M5;
  const m15 = ctx.indicators.M15;
  const struct5 = ctx.structure.M5;
  const struct15 = ctx.structure.M15;
  const spreadRatio =
    ctx.quote.mid > 0 ? ctx.quote.spread / ctx.quote.mid : 0;
  const atr = m5.atr14 ?? m15.atr14 ?? 0;
  const atrPct = ctx.quote.mid > 0 && atr ? atr / ctx.quote.mid : 0;

  const scores: Record<MarketRegime, number> = {
    TRENDING_UP: 0,
    TRENDING_DOWN: 0,
    RANGE: 0,
    BREAKOUT: 0,
    VOLATILE: 0,
    ACCUMULATION: 0,
    DISTRIBUTION: 0,
    NEWS_REACTION: 0,
  };

  if (m5.trend === "uptrend") scores.TRENDING_UP += 3;
  if (m15.trend === "uptrend") scores.TRENDING_UP += 2;
  if (m5.trend === "downtrend") scores.TRENDING_DOWN += 3;
  if (m15.trend === "downtrend") scores.TRENDING_DOWN += 2;

  if (struct5.structure === "range" || struct15.structure === "range") {
    scores.RANGE += 4;
  }

  const bb = m5.bollinger;
  if (bb && ctx.quote.mid > bb.upper * 0.998) scores.BREAKOUT += 2;
  if (bb && ctx.quote.mid < bb.lower * 1.002) scores.BREAKOUT += 2;

  if (atrPct > 0.003 || spreadRatio > 0.0003) scores.VOLATILE += 3;
  if (ctx.tickVelocity > (atr || 1) * 0.5) scores.VOLATILE += 2;

  if (struct15.structure === "range" && m5.trend === "sideways") {
    scores.ACCUMULATION += 2;
  }
  if (struct15.structure === "uptrend" && (m5.rsi14 ?? 50) > 65) {
    scores.DISTRIBUTION += 2;
  }

  if (ctx.tickVelocity > (atr || 1) * 1.2 && spreadRatio > 0.0002) {
    scores.NEWS_REACTION += 3;
  }

  return softmax(scores);
}

export function detectRegime(
  ctx: MarketContext,
  probabilities: RegimeProbabilities,
  prevDominant?: MarketRegime,
): RegimeInfo {
  const dominant = MARKET_REGIMES.reduce(
    (best, k) => (probabilities[k] > probabilities[best] ? k : best),
    MARKET_REGIMES[0]!,
  );

  const m5 = ctx.indicators.M5;
  const strength =
    m5.sma20 != null && m5.sma50 != null
      ? clampScore(
          Math.abs((m5.sma20 - m5.sma50) / ctx.quote.mid) * 10_000,
        )
      : 50;

  const persistence = prevDominant === dominant ? 75 : 40;

  return {
    dominant,
    probabilities,
    confidence: probabilities[dominant],
    strength,
    persistence,
  };
}
