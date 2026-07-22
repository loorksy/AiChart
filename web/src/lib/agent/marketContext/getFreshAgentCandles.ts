import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { getCandles, upsertCandles } from "@/lib/candles/candleRepository";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import type { AgentChartContext } from "../types";
import type { AgentCandle } from "./detectors";

export interface FreshAgentCandlesResult {
  currentTfCandles: AgentCandle[];
  liveCandles: AgentCandle[];
  liveError: string | null;
}

export async function getFreshAgentCandles(input: {
  userId?: number;
  symbol: string;
  interval: string;
  dataSource?: AgentChartContext["dataSource"];
  limit?: number;
}): Promise<FreshAgentCandlesResult> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const limit = Math.min(Math.max(input.limit ?? 1500, 10), 5000);
  // Analysis is intentionally source-locked to OANDA. The chart may display
  // broker candles, but EA/MT5 data is execution evidence (spread/fills), not
  // an alternate analytical history.
  const source = "oanda" as const;

  let liveCandles: AgentCandle[] = [];
  let liveError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const live = await fetchOhlc({
        userId: input.userId ?? 0,
        symbol,
        interval,
        market: "forex",
        limit: Math.min(limit, 1500),
        skipCache: true,
        source,
      });
      liveCandles = live.candles as AgentCandle[];
      liveError = null;
      if (liveCandles.length) {
        await upsertCandles(symbol, interval, liveCandles);
      }
      break;
    } catch (error) {
      liveError = error instanceof Error ? error.message : String(error);
      if (attempt === 0) continue;
    }
  }

  const currentTfCandles = await (async () => {
    const warehouse = (await getCandles({ symbol, interval, limit })) as AgentCandle[];
    if (!liveCandles.length || !warehouse.length) return warehouse.length ? warehouse : liveCandles;
    const liveLast = liveCandles[liveCandles.length - 1]!;
    const aligned = warehouse.slice();
    const whLast = aligned[aligned.length - 1]!;
    if (whLast.time === liveLast.time) {
      aligned[aligned.length - 1] = liveLast;
    } else if (whLast.time < liveLast.time) {
      aligned.push(liveLast);
    }
    return aligned;
  })();

  return { currentTfCandles, liveCandles, liveError };
}
