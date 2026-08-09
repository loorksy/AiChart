import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { getCandles, upsertCandles } from "@/lib/candles/candleRepository";
import {
  backfillCandles,
  pickWarehouseFeederUserId,
} from "@/lib/candles/candleBackfillService";
import { recordWarmDemand } from "@/lib/candles/warmDemand";
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
 * Cold MetaApi connect/deploy waits (up to 120s) must never sit on the request
 * path inside the market-data stage deadline. Prefer warehouse + one bounded
 * feeder page; refresh the operator's own tape in the background.
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

  const backgroundLive = () => {
    void pullLive().catch((error) => {
      log.debug("background live refresh failed", {
        symbol,
        interval,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  /**
   * Stale-warehouse rescue: wait a *bounded* slice of the market-data budget
   * for one live pull instead of guaranteeing a first-request freshness
   * failure. On a VPS after any idle period the warehouse tail is always
   * older than the sync guard's 3-bar window, so the old "serve cold + refresh
   * in background" behavior made the FIRST analysis fail every time and only
   * the retry succeed. A short await (default 5s) fixes the common case —
   * warm broker connection — while the timeout keeps cold MetaApi
   * connect/deploy waits (up to 120s) off the request path. On timeout the
   * pull keeps running in the background so the warehouse still heals.
   */
  const boundedLive = async (): Promise<AgentCandle[] | null> => {
    const budgetMs = Number(process.env.AGENT_LIVE_RESCUE_TIMEOUT_MS ?? "5000");
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) return null;
    const pull = pullLive();
    // Keep the warehouse healing even if we stop waiting.
    pull.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), budgetMs);
      if (typeof timer.unref === "function") timer.unref();
    });
    try {
      const result = await Promise.race([pull, timeout]);
      return result;
    } catch (error) {
      log.debug("bounded live rescue failed", {
        symbol,
        interval,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  if (FEATURES.boundedColdStartV1()) {
    const warehouse = (await getCandles({
      symbol,
      interval,
      limit,
    })) as AgentCandle[];
    const tailTime = warehouse.at(-1)?.time ?? null;
    const tailFresh =
      tailTime != null &&
      Date.now() - tailTime <= candleFreshnessToleranceMs(interval);

    // Nonempty warehouse: serve it. Fresh or closed-market → background refresh.
    // Stale + open market → still serve (quality/sync gates report honestly)
    // and deepen via feeder/background instead of blocking on cold RPC.
    if (warehouse.length) {
      void recordWarmDemand({ symbol, interval });
      if (tailFresh || !isForexMarketOpen(symbol)) {
        backgroundLive();
        return {
          currentTfCandles: warehouse,
          liveCandles: [],
          liveError: null,
        };
      }

      // Stale tail + open market: try one bounded live pull so the first
      // request after idle succeeds instead of bouncing off the sync guard.
      const rescued = await boundedLive();
      void backfillCandles({
        symbol,
        interval,
        limit,
        maxPages: 1,
        feederUserId: input.userId,
      }).catch(() => {
        // Best-effort deepen; analysis already has bars to reason on.
      });
      if (rescued && rescued.length) {
        const refreshed = (await getCandles({
          symbol,
          interval,
          limit,
        })) as AgentCandle[];
        return {
          currentTfCandles: refreshed.length ? refreshed : rescued,
          liveCandles: rescued,
          liveError: null,
        };
      }
      return {
        currentTfCandles: warehouse,
        liveCandles: [],
        liveError: null,
      };
    }

    // Empty warehouse: one bounded feeder page, then re-read. Avoids dual
    // live retries that stack past the market-data deadline on cold connect.
    void recordWarmDemand({ symbol, interval });
    const feeder =
      (input.userId && input.userId > 0
        ? input.userId
        : await pickWarehouseFeederUserId()) ?? undefined;
    try {
      await backfillCandles({
        symbol,
        interval,
        limit,
        maxPages: 1,
        feederUserId: feeder,
      });
    } catch (error) {
      log.debug("feeder backfill failed on empty warehouse", {
        symbol,
        interval,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const after = (await getCandles({
      symbol,
      interval,
      limit,
    })) as AgentCandle[];
    if (after.length) {
      backgroundLive();
      return { currentTfCandles: after, liveCandles: [], liveError: null };
    }
  }

  // Last resort: a single live pull (not two) when warehouse is still empty.
  let liveCandles: AgentCandle[] = [];
  let liveError: string | null = null;
  try {
    liveCandles = await pullLive();
  } catch (error) {
    liveError = error instanceof Error ? error.message : String(error);
  }

  const warehouse = (await getCandles({
    symbol,
    interval,
    limit,
  })) as AgentCandle[];
  if (!liveCandles.length || !warehouse.length) {
    return {
      currentTfCandles: warehouse.length ? warehouse : liveCandles,
      liveCandles,
      liveError,
    };
  }
  const liveLast = liveCandles[liveCandles.length - 1]!;
  const aligned = warehouse.slice();
  const whLast = aligned[aligned.length - 1]!;
  if (whLast.time === liveLast.time) {
    aligned[aligned.length - 1] = liveLast;
  } else if (whLast.time < liveLast.time) {
    aligned.push(liveLast);
  }
  return { currentTfCandles: aligned, liveCandles, liveError };
}
