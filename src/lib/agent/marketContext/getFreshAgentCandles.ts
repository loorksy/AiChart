import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import type { AgentChartContext } from "../types";
import type { AgentCandle } from "./detectors";

export interface FreshAgentCandlesResult {
  currentTfCandles: AgentCandle[];
  liveCandles: AgentCandle[];
  liveError: string | null;
}

/**
 * Candles for the analysis's own timeframe, live off the platform
 * OANDA feed. There is no warehouse tier and no bounded-rescue
 * timeout anymore — the fetch runs to completion (or failure) and that is
 * the whole answer.
 */
export async function getFreshAgentCandles(input: {
  userId?: number;
  symbol: string;
  interval: string;
  dataSource?: AgentChartContext["dataSource"];
  limit?: number;
}): Promise<FreshAgentCandlesResult> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const limit = Math.max(input.limit ?? 1500, 10);

  try {
    const live = await fetchOhlc({
      userId: input.userId ?? 0,
      symbol,
      interval,
      market: "forex",
      limit,
      skipCache: true,
      source: "oanda",
    });
    const candles = live.candles as AgentCandle[];
    return { currentTfCandles: candles, liveCandles: candles, liveError: live.warning ?? null };
  } catch (error) {
    return {
      currentTfCandles: [],
      liveCandles: [],
      liveError: error instanceof Error ? error.message : String(error),
    };
  }
}
