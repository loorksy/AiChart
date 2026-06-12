export type BinanceCaptureMarket = "spot" | "futures";

export interface BinanceCaptureConfig {
  enabled: boolean;
  timeoutMs: number;
  cacheTtlMs: number;
  viewport: { width: number; height: number };
  defaultMarket: BinanceCaptureMarket;
  browsersPath: string | null;
  chromiumExecutable: string | null;
}

export function getBinanceCaptureConfig(): BinanceCaptureConfig {
  const cacheSec = Number(process.env.BINANCE_CAPTURE_CACHE_SEC ?? "60");
  return {
    enabled: process.env.BINANCE_CAPTURE_ENABLED === "1",
    timeoutMs: Math.min(
      60_000,
      Math.max(5_000, Number(process.env.BINANCE_CAPTURE_TIMEOUT_MS ?? "25000")),
    ),
    cacheTtlMs: Math.max(0, cacheSec * 1000),
    viewport: {
      width: Number(process.env.BINANCE_CAPTURE_WIDTH ?? "1440"),
      height: Number(process.env.BINANCE_CAPTURE_HEIGHT ?? "900"),
    },
    defaultMarket:
      process.env.BINANCE_CAPTURE_DEFAULT_MARKET === "spot"
        ? "spot"
        : "futures",
    browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() || null,
    chromiumExecutable:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || null,
  };
}

export function binanceChartUrl(
  symbol: string,
  market: BinanceCaptureMarket,
): string {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (market === "spot") {
    const pair = sym.endsWith("USDT")
      ? `${sym.slice(0, -4)}_${sym.slice(-4)}`
      : sym;
    return `https://www.binance.com/en/trade/${pair}?type=spot`;
  }
  return `https://www.binance.com/en/futures/${sym}`;
}

export function cacheKey(
  symbol: string,
  interval: string,
  market: BinanceCaptureMarket,
  fullPage: boolean,
): string {
  return [symbol.toUpperCase(), interval, market, fullPage ? "full" : "vp"].join(
    ":",
  );
}
