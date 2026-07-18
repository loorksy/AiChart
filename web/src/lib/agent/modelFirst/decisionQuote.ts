import { getEaLiveQuote } from "@/lib/eaLiveState";
import { fetchOandaPricing } from "@/lib/markets/oanda";
import { pipSizeForSymbol, spreadFromBidAsk } from "@/lib/spread";
import type { AgentChartContext } from "../types";

export type DecisionQuote = {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  marketTimestamp: number;
  quoteAgeMs: number;
  source: "ea" | "oanda";
  pricePrecision: number;
  tickSize: number;
};

function finishQuote(input: {
  symbol: string;
  bid: number;
  ask: number;
  marketTimestamp: number;
  source: DecisionQuote["source"];
}): DecisionQuote | null {
  const spread = spreadFromBidAsk(input.bid, input.ask, input.symbol);
  if (!spread) return null;
  const tickSize = pipSizeForSymbol(input.symbol, spread.mid) / 10;
  const pricePrecision = Math.max(0, Math.round(-Math.log10(tickSize)));
  return {
    bid: input.bid,
    ask: input.ask,
    mid: spread.mid,
    spread: spread.spreadRaw,
    marketTimestamp: input.marketTimestamp,
    quoteAgeMs: Math.max(0, Date.now() - input.marketTimestamp),
    source: input.source,
    pricePrecision,
    tickSize,
  };
}

/** Resolve an actual bid/ask quote immediately before freezing a decision snapshot. */
export async function resolveDecisionQuote(input: {
  userId: number;
  symbol: string;
  dataSource?: AgentChartContext["dataSource"];
}): Promise<DecisionQuote | null> {
  if (input.dataSource === "ea") {
    const quote = await getEaLiveQuote(input.userId, input.symbol).catch(() => null);
    if (!quote) return null;
    return finishQuote({
      symbol: input.symbol,
      bid: quote.bid,
      ask: quote.ask,
      marketTimestamp: quote.updatedAt,
      source: "ea",
    });
  }

  const quote = (await fetchOandaPricing([input.symbol]).catch(() => []))[0];
  if (quote?.bid == null || quote.ask == null) return null;
  return finishQuote({
    symbol: input.symbol,
    bid: quote.bid,
    ask: quote.ask,
    marketTimestamp: Date.now(),
    source: "oanda",
  });
}
