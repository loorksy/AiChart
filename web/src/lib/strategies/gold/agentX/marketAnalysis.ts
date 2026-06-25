/**
 * Gold Agent X — multi-timeframe market analysis (M1/M5/M15).
 */
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { computeForexIndicators } from "@/lib/ohlc/indicators";
import { detectStructureLevels } from "@/lib/ohlc/structure";
import { GOLD_SYMBOL } from "../goldDefaults";
import type { CorrelationData, MarketContext, SessionInfo } from "./types";
import { resolveSessionInfo } from "./advisors/sessionAdvisor";
import { fetchCorrelationData } from "./advisors/correlationAdvisor";
import type { GoldAgentXConfig } from "../goldTypes";

const CANDLE_LIMIT = 300;

function tickVelocity(candles: { close: number }[]): number {
  if (candles.length < 5) return 0;
  const recent = candles.slice(-5);
  const delta = Math.abs(recent[recent.length - 1]!.close - recent[0]!.close);
  return delta / recent.length;
}

export async function analyzeMarket(
  userId: number,
  quote: { bid: number; ask: number },
  config: GoldAgentXConfig,
  prevMid?: number,
): Promise<MarketContext> {
  const spread = Math.max(quote.ask - quote.bid, 0);
  const mid = (quote.bid + quote.ask) / 2;

  const [m1, m5, m15] = await Promise.all(
    (["M1", "M5", "M15"] as const).map(async (interval) => {
      const res = await fetchOhlc({
        userId,
        symbol: GOLD_SYMBOL,
        market: "forex",
        interval,
        limit: CANDLE_LIMIT,
      });
      return res;
    }),
  );

  const indicators = {
    M1: computeForexIndicators(GOLD_SYMBOL, "M1", m1.candles, m1.source),
    M5: computeForexIndicators(GOLD_SYMBOL, "M5", m5.candles, m5.source),
    M15: computeForexIndicators(GOLD_SYMBOL, "M15", m15.candles, m15.source),
  };

  const structure = {
    M5: detectStructureLevels(GOLD_SYMBOL, "M5", m5.candles),
    M15: detectStructureLevels(GOLD_SYMBOL, "M15", m15.candles),
  };

  const velocity =
    prevMid != null && prevMid > 0
      ? Math.abs(mid - prevMid)
      : tickVelocity(m1.candles);

  const session = resolveSessionInfo(Date.now());
  const correlation = await fetchCorrelationData(userId, config.correlationSymbols);

  return {
    symbol: GOLD_SYMBOL,
    userId,
    quote: { bid: quote.bid, ask: quote.ask, spread, mid },
    candles: { M1: m1.candles, M5: m5.candles, M15: m15.candles },
    indicators,
    structure,
    tickVelocity: velocity,
    timestamp: Date.now(),
    session,
    correlation,
  };
}

export type { CorrelationData, MarketContext, SessionInfo };
