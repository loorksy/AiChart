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
  const source = input.dataSource ?? "oanda";

  let liveCandles: AgentCandle[] = [];
  let liveError: string | null = null;
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
    if (source === "oanda" && liveCandles.length) {
      await upsertCandles(symbol, interval, liveCandles);
    }
  } catch (error) {
    liveError = error instanceof Error ? error.message : String(error);
  }

  const currentTfCandles =
    source === "oanda"
      ? ((await getCandles({ symbol, interval, limit })) as AgentCandle[])
      : liveCandles;

  return { currentTfCandles, liveCandles, liveError };
}

