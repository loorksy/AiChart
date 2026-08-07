/**
 * Canonical broker-native intervals + interval-aware cache policy.
 *
 * `@/lib/intervals` stays the broad UI/agent interval registry (incl. derived
 * resampled intervals like 3m/45m). This module is the strict subset the
 * user's MetaTrader account serves natively via MetaApi — the Candle
 * Warehouse and backfill pipeline key on these, so every non-native request
 * resolves to a native base first.
 */
import { barDurationMs, DERIVED_INTERVALS } from "@/lib/intervals";

export const CANONICAL_BROKER_INTERVALS = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "1w",
  "1M",
] as const;

export type CanonicalInterval = (typeof CANONICAL_BROKER_INTERVALS)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_BROKER_INTERVALS);

export function isCanonicalInterval(value: string): value is CanonicalInterval {
  return CANONICAL_SET.has(value);
}

/** TradingView resolution strings and legacy aliases → canonical interval. */
const ALIASES: Record<string, CanonicalInterval> = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "2h",
  "240": "4h",
  "360": "6h",
  "480": "8h",
  "720": "12h",
  "1D": "1d",
  D: "1d",
  "1W": "1w",
  W: "1w",
  M: "1M",
};

/**
 * Non-native intervals that are NOT in DERIVED_INTERVALS but appear in the UI
 * list (3m, 3d). The broker feed has no M3/D3 granularity, so these are
 * resampled from a native base rather than fetched directly.
 */
const EXTRA_RESAMPLE: Record<string, { base: CanonicalInterval; factor: number }> = {
  "3m": { base: "1m", factor: 3 },
  "3d": { base: "1d", factor: 3 },
};

export interface CanonicalPlan {
  /** Native broker interval to fetch/store. */
  base: CanonicalInterval;
  /** How many base candles aggregate into one requested candle (1 = native). */
  factor: number;
}

/**
 * Resolve any interval to a native broker base + resample factor. Native and
 * TV-resolution inputs map 1:1 (factor 1); derived/non-native intervals
 * (3m→1m×3, 45m→15m×3, 2d→1d×2…) carry a factor > 1; unknown input falls back.
 */
export function canonicalPlan(
  value: string | null | undefined,
  fallback: CanonicalInterval = "15m",
): CanonicalPlan {
  if (!value) return { base: fallback, factor: 1 };
  const iv = value.trim();
  if (isCanonicalInterval(iv)) return { base: iv, factor: 1 };
  const alias = ALIASES[iv];
  if (alias) return { base: alias, factor: 1 };
  const extra = EXTRA_RESAMPLE[iv];
  if (extra) return extra;
  const derived = DERIVED_INTERVALS[iv];
  if (derived && isCanonicalInterval(derived.base)) {
    return { base: derived.base, factor: derived.factor };
  }
  return { base: fallback, factor: 1 };
}

/**
 * Coerce arbitrary input (canonical, TV resolution, derived interval) to a
 * canonical broker interval — the base of {@link canonicalPlan}. Unknown values
 * fall back to `fallback`.
 */
export function normalizeCanonicalInterval(
  value: string | null | undefined,
  fallback: CanonicalInterval = "15m",
): CanonicalInterval {
  return canonicalPlan(value, fallback).base;
}

/** Higher timeframe used for multi-timeframe confluence per chart interval. */
const HIGHER: Record<CanonicalInterval, CanonicalInterval> = {
  "1m": "15m",
  "5m": "1h",
  "15m": "1h",
  "30m": "4h",
  "1h": "4h",
  "2h": "1d",
  "4h": "1d",
  "6h": "1d",
  "8h": "1d",
  "12h": "1d",
  "1d": "1w",
  "1w": "1M",
  "1M": "1M",
};

export function getHigherInterval(interval: string): CanonicalInterval {
  return HIGHER[normalizeCanonicalInterval(interval)];
}

/**
 * Interval-aware cache TTL: a 1m chart goes stale in seconds; a daily chart
 * is fresh for an hour. Replaces the old fixed 45s TTL everywhere candles are
 * cached (server OHLC cache, client kline cache, warehouse refresh decisions).
 */
export function ohlcCacheTtlMs(interval: string): number {
  switch (normalizeCanonicalInterval(interval)) {
    case "1m":
      return 10_000;
    case "5m":
      return 30_000;
    case "15m":
      return 60_000;
    case "30m":
      return 120_000;
    case "1h":
      return 5 * 60_000;
    case "2h":
    case "4h":
    case "6h":
    case "8h":
    case "12h":
      return 15 * 60_000;
    case "1d":
    case "1w":
    case "1M":
      return 60 * 60_000;
    default:
      return 60_000;
  }
}

/**
 * How old the newest stored candle may be before the warehouse must refresh
 * from the linked broker account. The forming candle keeps `time` = its open, so tolerate up to
 * two bar durations plus a TTL margin (weekends are judged separately by the
 * market-session check).
 */
export function candleFreshnessToleranceMs(interval: string): number {
  const canonical = normalizeCanonicalInterval(interval);
  return 2 * barDurationMs(canonical) + ohlcCacheTtlMs(canonical);
}
