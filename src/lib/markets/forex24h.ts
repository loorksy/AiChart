import { barDurationSec } from "@/lib/intervals";
import { normalizeInterval } from "@/lib/intervals";
import { fetchOhlc, type OhlcCandle } from "@/lib/ohlc/fetchOhlc";

/** Rolling 24-hour window in milliseconds (wall-clock, not bar count). */
export const MS_24H = 86_400_000;

export interface Forex24hRange {
  high24h: number;
  low24h: number;
  change24hPct: number;
  approximate: boolean;
}

export interface HighLowWindow {
  high24h: number | null;
  low24h: number | null;
  refClose: number | null;
}

/** Filters candles by open time and returns high/low plus reference close near cutoff. */
export function highLowFromWindow(
  candles: OhlcCandle[],
  cutoffMs: number,
): HighLowWindow {
  const window = candles.filter((c) => c.time >= cutoffMs);
  if (window.length === 0) {
    return { high24h: null, low24h: null, refClose: null };
  }

  const atOrBeforeCutoff = candles.filter((c) => c.time <= cutoffMs);
  const refClose =
    atOrBeforeCutoff.length > 0
      ? atOrBeforeCutoff[atOrBeforeCutoff.length - 1]!.close
      : (window[0]?.close ?? null);

  return {
    high24h: Math.max(...window.map((c) => c.high)),
    low24h: Math.min(...window.map((c) => c.low)),
    refClose,
  };
}

function changePct(current: number, refClose: number | null): number {
  if (refClose == null || refClose <= 0 || current <= 0) return 0;
  return ((current - refClose) / refClose) * 100;
}

/**
 * Computes forex 24h high/low from candle timestamps (not a fixed bar count).
 * When interval > 1h, fetches supplementary 1h candles for accurate 24h range.
 */
export async function computeForex24hRange(
  userId: number,
  symbol: string,
  interval: string,
  primaryCandles: OhlcCandle[],
  livePrice = 0,
): Promise<Forex24hRange> {
  const tf = normalizeInterval(interval);
  const anchorMs =
    primaryCandles.length > 0
      ? Math.max(...primaryCandles.map((c) => c.time))
      : Date.now();
  const cutoffMs = anchorMs - MS_24H;

  let candlesForRange = primaryCandles;
  let approximate = false;

  if (barDurationSec(tf) > 3600) {
    try {
      const hourly = await fetchOhlc({
        userId,
        symbol,
        interval: "1h",
        market: "forex",
        limit: 30,
      });
      if (hourly.candles.length > 0) {
        candlesForRange = hourly.candles;
      } else {
        approximate = true;
      }
    } catch {
      approximate = true;
    }
  }

  let { high24h, low24h, refClose } = highLowFromWindow(
    candlesForRange,
    cutoffMs,
  );

  if (high24h === null && primaryCandles.length > 0) {
    const fallback = highLowFromWindow(primaryCandles, cutoffMs);
    high24h = fallback.high24h;
    low24h = fallback.low24h;
    refClose = fallback.refClose;
    approximate = true;
  }

  const price =
    livePrice > 0
      ? livePrice
      : (primaryCandles[primaryCandles.length - 1]?.close ?? 0);

  return {
    high24h: high24h ?? 0,
    low24h: low24h ?? 0,
    change24hPct: changePct(price, refClose),
    approximate,
  };
}
