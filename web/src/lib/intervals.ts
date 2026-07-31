/** Supported chart/kline intervals. */
export const MARKET_INTERVALS = [
  "1m",
  "3m",
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
  "3d",
  "1w",
  "1M",
] as const;

export type MarketInterval = (typeof MARKET_INTERVALS)[number];

export const INTERVAL_SET = new Set<string>(MARKET_INTERVALS);

/**
 * Non-native intervals derived by resampling a native base. Lets the platform
 * expose "any" timeframe without each exchange supporting it directly.
 */
export const DERIVED_INTERVALS: Record<string, { base: string; factor: number }> =
  {
    "2w": { base: "1w", factor: 2 },
    "10m": { base: "5m", factor: 2 },
    "45m": { base: "15m", factor: 3 },
    "2d": { base: "1d", factor: 2 },
  };

/** All intervals the agent/UI may request (native + derived). */
export const ALL_INTERVALS: string[] = [
  ...MARKET_INTERVALS,
  ...Object.keys(DERIVED_INTERVALS),
];

export const INTERVAL_GROUPS: { label: string; items: string[] }[] = [
  {
    label: "لحظي",
    items: ["1m", "3m", "5m", "10m", "15m", "30m", "45m"],
  },
  {
    label: "سوينغ",
    items: ["1h", "2h", "4h", "6h", "8h", "12h"],
  },
  {
    label: "طويل",
    items: ["1d", "2d", "3d", "1w", "2w", "1M"],
  },
];

/**
 * Coerce arbitrary input to a supported interval (native or derived). Unknown
 * values fall back to "1h". Accepts both native and derived intervals so the
 * resampling path stays reachable.
 */
export function normalizeInterval(interval: string): string {
  const iv = interval.trim();
  if (INTERVAL_SET.has(iv) || iv in DERIVED_INTERVALS) return iv;
  // Understand TradingView/MetaTrader spellings ("1D", "60", "M15") before
  // falling back — silently coercing an agent's "1D" to 1h re-anchored its
  // drawings on the wrong timeframe and yanked the operator's chart to 1h.
  return canonicalizeInterval(iv) ?? "1h";
}

/** TradingView bare-minute resolutions → canonical intervals. */
const MINUTES_TO_INTERVAL: Record<number, string> = {
  1: "1m",
  3: "3m",
  5: "5m",
  10: "10m",
  15: "15m",
  30: "30m",
  45: "45m",
  60: "1h",
  120: "2h",
  240: "4h",
  360: "6h",
  480: "8h",
  720: "12h",
  1440: "1d",
  2880: "2d",
  4320: "3d",
  10080: "1w",
  20160: "2w",
  43200: "1M",
};

const UNIT_SUFFIX: Record<string, string> = {
  m: "m",
  min: "m",
  mins: "m",
  minute: "m",
  minutes: "m",
  h: "h",
  hr: "h",
  hour: "h",
  hours: "h",
  d: "d",
  day: "d",
  days: "d",
  w: "w",
  wk: "w",
  week: "w",
  weeks: "w",
  mo: "M",
  mon: "M",
  month: "M",
  months: "M",
};

/**
 * Canonicalises an agent-supplied timeframe label ("1D", "4H", "15 min") to a
 * supported interval, or null when the platform cannot chart it.
 *
 * Unlike {@link normalizeInterval} this never falls back to "1h": a caller that
 * asked for four timeframes must learn which one was unavailable instead of
 * silently receiving the same hourly chart several times.
 *
 * Case note: the canonical set contains both `1m` (minute) and `1M` (month), so
 * an exact match is honoured first and only unmatched labels are case-folded.
 */
export function canonicalizeInterval(interval: string): string | null {
  const raw = interval.trim();
  if (!raw) return null;
  if (INTERVAL_SET.has(raw) || raw in DERIVED_INTERVALS) return raw;

  const upper = raw.toUpperCase();

  // TradingView bare resolutions: "15" (minutes), "60", "240", "D", "W", "M".
  if (/^\d{1,5}$/.test(upper)) {
    return MINUTES_TO_INTERVAL[Number(upper)] ?? null;
  }
  if (/^(D|W|MN?)1?$/.test(upper)) {
    return upper.startsWith("D") ? "1d" : upper.startsWith("W") ? "1w" : "1M";
  }

  // MetaTrader prefix labels: "M15", "H4", "D1", "W1", "MN1".
  const mt = /^(MN|M|H|D|W)(\d{1,3})$/.exec(upper);
  if (mt) {
    const n = Number(mt[2]);
    const unit = mt[1]!;
    const candidate =
      unit === "M"
        ? MINUTES_TO_INTERVAL[n] ?? null
        : unit === "H"
          ? MINUTES_TO_INTERVAL[n * 60] ?? null
          : unit === "D"
            ? `${n}d`
            : unit === "W"
              ? `${n}w`
              : "1M";
    return candidate && (INTERVAL_SET.has(candidate) || candidate in DERIVED_INTERVALS)
      ? candidate
      : null;
  }

  const match = /^(\d{1,4})\s*([a-zA-Z]{1,6})$/.exec(raw);
  if (!match) return null;
  const suffix = UNIT_SUFFIX[match[2]!.toLowerCase()];
  if (!suffix) return null;

  const candidate = `${Number(match[1])}${suffix}`;
  return INTERVAL_SET.has(candidate) || candidate in DERIVED_INTERVALS
    ? candidate
    : null;
}

/** Seconds per candle for forecast path time mapping + duration-based tiering. */
export function barDurationSec(interval: string): number {
  const map: Record<string, number> = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "10m": 600,
    "15m": 900,
    "30m": 1800,
    "45m": 2700,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "6h": 21600,
    "8h": 28800,
    "12h": 43200,
    "1d": 86400,
    "2d": 172800,
    "3d": 259200,
    "1w": 604800,
    "2w": 1209600,
    "1M": 2592000, // ~30d
  };
  return map[interval] ?? 3600;
}

/** Milliseconds per candle (for chart history pagination). */
export function barDurationMs(interval: string): number {
  return barDurationSec(interval) * 1000;
}

export interface IntervalPlan {
  /** The interval to actually fetch from the exchange. */
  base: string;
  /** How many base candles aggregate into one requested candle (1 = native). */
  factor: number;
}

/** Resolves a requested interval to the base interval + resample factor. */
export function intervalPlan(interval: string): IntervalPlan {
  const iv = normalizeInterval(interval);
  const derived = DERIVED_INTERVALS[iv];
  if (derived) return { base: derived.base, factor: derived.factor };
  return { base: iv, factor: 1 };
}

/**
 * MetaTrader (EA get_ohlc) supports only M1/M5/M15/M30/H1/H4/D1/W1/MN1. Any
 * other interval must be resampled from a supported base, or the EA silently
 * returns the chart's own period. Returns the EA interval to request + factor.
 */
const MT5_NATIVE = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1M",
]);

export function mt5IntervalPlan(interval: string): IntervalPlan {
  const iv = normalizeInterval(interval);
  if (MT5_NATIVE.has(iv)) return { base: iv, factor: 1 };
  const map: Record<string, IntervalPlan> = {
    "3m": { base: "1m", factor: 3 },
    "10m": { base: "5m", factor: 2 },
    "45m": { base: "15m", factor: 3 },
    "2h": { base: "1h", factor: 2 },
    "6h": { base: "1h", factor: 6 },
    "8h": { base: "4h", factor: 2 },
    "12h": { base: "4h", factor: 3 },
    "2d": { base: "1d", factor: 2 },
    "3d": { base: "1d", factor: 3 },
    "2w": { base: "1w", factor: 2 },
  };
  return map[iv] ?? { base: "1h", factor: 1 };
}

export interface ResampleCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Aggregates base candles into coarser candles, `factor` bars per output bar.
 * open = first.open, high = max, low = min, close = last.close, volume = sum,
 * time = first bar's open time. Trailing partial groups are dropped so every
 * returned candle is complete. factor <= 1 returns the input unchanged.
 */
export function resampleOhlc<T extends ResampleCandle>(
  candles: T[],
  factor: number,
): ResampleCandle[] {
  if (factor <= 1 || candles.length === 0) return candles.slice();
  const out: ResampleCandle[] = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const group = candles.slice(i, i + factor);
    const first = group[0]!;
    const last = group[group.length - 1]!;
    out.push({
      time: first.time,
      open: first.open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: last.close,
      volume: group.reduce((s, c) => s + (c.volume ?? 0), 0),
    });
  }
  return out;
}
