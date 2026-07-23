import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import { CANDLE_RETENTION_MS } from "./candleRepository";

export function candleHistoryYears(): number {
  const configured = Number(process.env.CANDLE_HISTORY_YEARS ?? "5");
  return Number.isFinite(configured)
    ? Math.min(Math.max(configured, 1), 10)
    : 5;
}

/** Earliest open time that the warehouse should retain for an interval. */
export function targetHistoryStartMs(interval: string, nowMs = Date.now()): number {
  const years = candleHistoryYears();
  const desired = years * 365.25 * 24 * 60 * 60 * 1000;
  const retention = CANDLE_RETENTION_MS[normalizeCanonicalInterval(interval)];
  return nowMs - Math.min(desired, retention ?? desired);
}
