import { buildKlinesUrl } from "@/lib/chart/tv/tvDatafeed";
import { barDurationMs } from "@/lib/intervals";
import type { AgentChartContext } from "../types";

function normSymbol(value: string): string {
  return value.split(":").pop()!.trim().toUpperCase();
}

function candleFreshEnough(
  candle: NonNullable<AgentChartContext["latestCandle"]>,
  symbol: string,
  interval: string,
): boolean {
  if (!candle.time) return false;
  if (candle.symbol && normSymbol(candle.symbol) !== normSymbol(symbol)) return false;
  if (candle.interval && candle.interval !== interval) return false;
  const maxAge = (barDurationMs(interval) || 60_000) * 2;
  return Date.now() - candle.time <= maxAge;
}

/** Prefer a fresh chart tail candle; fall back to a live klines fetch before analysis. */
export async function resolveLatestChartCandle(input: {
  symbol: string;
  interval: string;
  dataSource?: AgentChartContext["dataSource"];
  fromChart?: AgentChartContext["latestCandle"];
}): Promise<AgentChartContext["latestCandle"] | undefined> {
  const symbol = input.symbol.toUpperCase();
  const interval = input.interval;
  const fromChart = input.fromChart;

  if (fromChart && candleFreshEnough(fromChart, symbol, interval)) {
    return fromChart;
  }

  try {
    const url = buildKlinesUrl({
      symbol,
      interval,
      limit: 2,
      fresh: true,
    });
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      candles?: Array<{
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume?: number;
      }>;
    };
    const last = data.candles?.[data.candles.length - 1];
    if (!last || !Number.isFinite(last.time)) return undefined;
    const timeMs = last.time < 1_000_000_000_000 ? last.time * 1000 : last.time;
    return {
      symbol,
      interval,
      time: timeMs,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      volume: last.volume,
    };
  } catch {
    return undefined;
  }
}
