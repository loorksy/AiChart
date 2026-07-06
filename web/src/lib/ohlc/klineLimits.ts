import { normalizeInterval } from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";

/** Default kline count per interval — forex uses OANDA (max 5000/request). */
export function defaultKlineLimit(
  interval: string,
  _market: MarketType = "forex",
): number {
  const iv = normalizeInterval(interval);
  switch (iv) {
    case "1m":
    case "3m":
      return 1000;
    case "5m":
    case "10m":
    case "15m":
      return 800;
    case "30m":
    case "45m":
      return 800;
    case "1h":
      return 800;
    case "2h":
    case "4h":
    case "6h":
      return 400;
    default:
      return 300;
  }
}
