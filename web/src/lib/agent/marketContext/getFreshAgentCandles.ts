import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { getCandles, upsertCandles } from "@/lib/candles/candleRepository";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import {
  candleFreshnessToleranceMs,
  normalizeCanonicalInterval,
} from "@/lib/markets/intervals";
import { isForexMarketOpen } from "@/lib/agent/marketSession";
import { FEATURES } from "@/lib/agent/featureFlags";
import { createLogger } from "@/lib/logger";
import type { AgentChartContext } from "../types";
import type { AgentCandle } from "./detectors";

const log = createLogger("agent.freshCandles");

export interface FreshAgentCandlesResult {
  currentTfCandles: AgentCandle[];
  liveCandles: AgentCandle[];
  liveError: string | null;
}

/**
 * Candles for the analysis's own timeframe — warehouse first, live second.
 *
 * This used to block on a live MetaApi pull (two attempts, skipCache) BEFORE
 * reading the warehouse. On a warm connection that is a quick tail refresh; on
 * a cold one — every first analysis after a deploy or pm2 restart, because the
 * connection cache is per-process — establishing the RPC session alone takes
 * tens of seconds, and the market-data stage's ten-second deadline killed the
 * run before the 28ms warehouse read was ever reached. Request 3702237f
 * (2026-08-07 18:05, five minutes after a restart) failed exactly this way.
 *
 * Order now: read the warehouse (fast, local). If its tail is within the
 * interval's freshness tolerance — or the market is closed, when no newer
 * candle can exist — serve it and let the live pull run in the BACKGROUND,
 * which also warms the connection for the next request. Only a stale-or-empty
 * warehouse with an open market still blocks on the live pull, because then
 * the live tape is the only honest source.
 *
 * No fabrication risk: downstream freshness is computed from the candles' own
 * timestamps (buildAgentMarketContext), so if this serves data that is too
 * old the quality gate still says so.
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
  const limit = Math.min(Math.max(input.limit ?? 1500, 10), 5000);
  // The user's own linked MetaTrader account is the only pipe — analysis
  // reads the same tape the trader's orders would fill against.
  const source = "metaapi" as const;

  const pullLive = async (): Promise<AgentCandle[]> => {
    const live = await fetchOhlc({
      userId: input.userId ?? 0,
      symbol,
      interval,
      market: "forex",
      limit: Math.min(limit, 1500),
      skipCache: true,
      source,
    });
    const candles = live.candles as AgentCandle[];
    if (candles.length) {
      await upsertCandles(symbol, interval, candles);
    }
    return candles;
  };

  if (FEATURES.boundedColdStartV1()) {
    const warehouse = (await getCandles({ symbol, interval, limit })) as AgentCandle[];
    const tailTime = warehouse.at(-1)?.time ?? null;
    const tailFresh =
      tailTime != null && Date.now() - tailTime <= candleFreshnessToleranceMs(interval);
    if (warehouse.length && (tailFresh || !isForexMarketOpen(symbol))) {
      // Fresh enough to decide on; refresh the tail off the critical path.
      // This is also what warms a cold RPC connection without a user waiting
      // behind it.
      void pullLive().catch((error) => {
        log.debug("background live refresh failed", {
          symbol,
          interval,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return { currentTfCandles: warehouse, liveCandles: [], liveError: null };
    }
  }

  let liveCandles: AgentCandle[] = [];
  let liveError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      liveCandles = await pullLive();
      liveError = null;
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
