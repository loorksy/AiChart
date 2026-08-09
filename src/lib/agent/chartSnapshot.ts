import type { AgentChartContext } from "./types";
import type { AgentMarketContext } from "./marketContext/buildAgentMarketContext";

export interface ChartSnapshotInput {
  symbol?: string | null;
  interval?: string | null;
  latestCandleTime?: number | null;
  latestClose?: number | null;
  visibleRange?: AgentChartContext["visibleRange"];
  candleCount?: number | null;
}

function stableNumber(value: number | null | undefined, decimals = 6): string {
  return Number.isFinite(value)
    ? Number(value).toFixed(decimals)
    : "null";
}

function stableTime(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "null";
  const n = Number(value);
  return String(n < 1_000_000_000_000 ? Math.round(n * 1000) : Math.round(n));
}

export function hashChartSnapshot(input: ChartSnapshotInput): string {
  const payload = [
    (input.symbol ?? "").toUpperCase(),
    input.interval ?? "",
    stableTime(input.latestCandleTime),
    stableNumber(input.latestClose),
    stableTime(input.visibleRange?.from),
    stableTime(input.visibleRange?.to),
    String(input.candleCount ?? 0),
  ].join("|");

  // Small deterministic FNV-1a hash. Good enough for session identity; this is
  // not a security boundary.
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hashMarketSnapshot(
  market: AgentMarketContext,
  visibleRange?: AgentChartContext["visibleRange"],
): string {
  const latest = market.currentTfCandles.at(-1);
  return hashChartSnapshot({
    symbol: market.symbol,
    interval: market.interval,
    latestCandleTime: latest?.time ?? market.freshness.lastCandleTime,
    latestClose: latest?.close ?? market.currentPrice,
    visibleRange,
    candleCount: market.currentTfCandles.length,
  });
}

