/** Binance Spot intervals supported in market UI and APIs. */
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
  "12h",
  "1d",
  "3d",
  "1w",
] as const;

export type MarketInterval = (typeof MARKET_INTERVALS)[number];

export const INTERVAL_SET = new Set<string>(MARKET_INTERVALS);

export const INTERVAL_GROUPS: { label: string; items: MarketInterval[] }[] = [
  {
    label: "لحظي",
    items: ["1m", "3m", "5m", "15m", "30m"],
  },
  {
    label: "سوينغ",
    items: ["1h", "2h", "4h", "6h", "12h"],
  },
  {
    label: "طويل",
    items: ["1d", "3d", "1w"],
  },
];

export function normalizeInterval(interval: string): MarketInterval {
  const iv = interval.trim();
  return INTERVAL_SET.has(iv) ? (iv as MarketInterval) : "1h";
}

/** Seconds per candle for forecast path time mapping. */
export function barDurationSec(interval: string): number {
  const map: Record<string, number> = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "6h": 21600,
    "12h": 43200,
    "1d": 86400,
    "3d": 259200,
    "1w": 604800,
  };
  return map[interval] ?? 3600;
}
