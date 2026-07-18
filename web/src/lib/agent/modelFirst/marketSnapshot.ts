/**
 * Immutable market snapshot for one analytical request.
 */
import { createHash, randomUUID } from "node:crypto";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import {
  platformChartBoundScope,
  resolveContextTimeframes,
  type AnalysisScope,
} from "./contextTimeframes";
import { buildCandleEnvelope, type CandleEnvelope } from "./candleEnvelope";

export type MarketSnapshot = {
  snapshotId: string;
  userId: number;
  symbol: string;
  primaryTimeframe: string;
  scope: AnalysisScope;
  brokerOrSource: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread: number | null;
  marketTimestamp: number | null;
  serverTimestamp: number;
  quoteAgeMs: number | null;
  pricePrecision: number | null;
  tickSize: number | null;
  candleCoverage: Record<string, { available: number; sufficient: boolean }>;
  candleCloseTimes: Record<string, number | null>;
  marketOpen: boolean | null;
  newsDataState: string;
  chartImageCaptureTimestamps: Record<string, number>;
  sourceHealth: "ok" | "degraded" | "unknown";
  envelopes: CandleEnvelope[];
  fingerprint: string;
};

const MAX_SNAPSHOT_IMAGE_SKEW_MS = 45_000;

export function buildMarketSnapshot(input: {
  userId: number;
  market: AgentMarketContext;
  contextCandles?: Record<string, AgentMarketContext["currentTfCandles"]>;
  newsDataState?: string;
  tickSize?: number | null;
  pricePrecision?: number | null;
}): MarketSnapshot {
  const primary = input.market.interval;
  const scope = platformChartBoundScope({
    symbol: input.market.symbol,
    timeframe: primary,
  });
  const { context } = resolveContextTimeframes(primary);
  const envelopes: CandleEnvelope[] = [
    buildCandleEnvelope({
      timeframe: primary,
      role: "primary",
      candles: input.market.currentTfCandles,
    }),
  ];
  for (const tf of context) {
    const series = input.contextCandles?.[tf];
    if (!series?.length) continue;
    envelopes.push(
      buildCandleEnvelope({
        timeframe: tf,
        role: "context",
        candles: series,
      }),
    );
  }

  const mid = input.market.currentPrice;
  const spread = input.market.spread ?? null;
  const bid =
    mid != null && spread != null ? mid - spread / 2 : mid;
  const ask =
    mid != null && spread != null ? mid + spread / 2 : mid;
  const marketTimestamp = envelopes[0]?.lastCandleTime ?? null;
  const serverTimestamp = Date.now();
  const quoteAgeMs =
    marketTimestamp != null ? Math.max(0, serverTimestamp - marketTimestamp * 1000) : null;

  const candleCoverage: MarketSnapshot["candleCoverage"] = {};
  const candleCloseTimes: MarketSnapshot["candleCloseTimes"] = {};
  for (const env of envelopes) {
    candleCoverage[env.timeframe] = {
      available: env.availableCount,
      sufficient: env.includedCount >= 40,
    };
    candleCloseTimes[env.timeframe] = env.lastCandleTime;
  }

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        symbol: input.market.symbol,
        primary,
        mid,
        spread,
        closes: envelopes.map((e) => [e.timeframe, e.lastCandleTime, e.includedCount]),
      }),
    )
    .digest("hex")
    .slice(0, 24);

  return {
    snapshotId: randomUUID(),
    userId: input.userId,
    symbol: input.market.symbol.toUpperCase(),
    primaryTimeframe: primary,
    scope,
    brokerOrSource: "warehouse",
    bid,
    ask,
    mid: mid ?? null,
    spread,
    marketTimestamp,
    serverTimestamp,
    quoteAgeMs,
    pricePrecision: input.pricePrecision ?? null,
    tickSize: input.tickSize ?? null,
    candleCoverage,
    candleCloseTimes,
    marketOpen: null,
    newsDataState: input.newsDataState ?? "unknown",
    chartImageCaptureTimestamps: {},
    sourceHealth: input.market.dataQuality?.sufficient ? "ok" : "degraded",
    envelopes,
    fingerprint,
  };
}

export function assertSnapshotImageFreshness(
  snapshot: MarketSnapshot,
  captureTimestamps: Record<string, number>,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  for (const [tf, ts] of Object.entries(captureTimestamps)) {
    if (Math.abs(now - ts) > MAX_SNAPSHOT_IMAGE_SKEW_MS) {
      return { ok: false, reason: `stale_image_${tf}` };
    }
    if (Math.abs(ts - snapshot.serverTimestamp) > MAX_SNAPSHOT_IMAGE_SKEW_MS) {
      return { ok: false, reason: `snapshot_image_skew_${tf}` };
    }
  }
  return { ok: true };
}

export { MAX_SNAPSHOT_IMAGE_SKEW_MS };
