export type FreshnessSource = "live" | "stale" | "heartbeat" | "cache" | "unknown";

export interface FreshnessMeta {
  source: FreshnessSource;
  ageMs: number;
  thresholdMs: number;
  isFresh: boolean;
}

function defaultStaleThresholdMs(): number {
  const raw = Number(process.env.STALE_QUOTE_MS ?? process.env.BRIDGE_STALE_QUOTE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
}

export function getStaleQuoteThresholdMs(overrideMs?: number): number {
  return overrideMs ?? defaultStaleThresholdMs();
}

export function isQuoteFresh(
  quoteAgeMs: number | null | undefined,
  thresholdMs?: number,
): boolean {
  if (quoteAgeMs === null || quoteAgeMs === undefined || !Number.isFinite(quoteAgeMs)) {
    return false;
  }
  return quoteAgeMs <= getStaleQuoteThresholdMs(thresholdMs);
}

export function freshnessMeta(
  source: FreshnessSource,
  ageMs: number,
  thresholdMs?: number,
): FreshnessMeta {
  const threshold = getStaleQuoteThresholdMs(thresholdMs);
  return {
    source,
    ageMs,
    thresholdMs: threshold,
    isFresh: ageMs <= threshold,
  };
}

function defaultMaxSpreadPips(): number {
  const raw = Number(process.env.MAX_SPREAD_PIPS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

export function getMaxSpreadPips(overridePips?: number): number {
  return overridePips ?? defaultMaxSpreadPips();
}
