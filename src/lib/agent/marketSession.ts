/**
 * Forex/metals market-session check — thin delegate over the trading calendar
 * (web/src/lib/markets/tradingCalendar.ts), which models the week in New York
 * WALL time (DST-correct) and knows the metals daily maintenance break.
 *
 * Exported names are preserved so existing call sites keep compiling; the
 * behavioural change is that `isForexMarketOpen` finally honours its symbol
 * argument. Exchange holidays remain unmodelled by design.
 */
import { getSessionStatus, isMarketOpenAt } from "@/lib/markets/tradingCalendar";

export interface MarketSessionStatus {
  isOpen: boolean;
  reason: string;
}

/**
 * Session status for the generic FX week. Callers that know their symbol
 * should prefer `getSessionStatus(symbol)` from the trading calendar; this
 * signature is kept for legacy call sites that have no symbol in scope.
 */
export function getForexSessionStatus(now: Date = new Date()): MarketSessionStatus {
  return getSessionStatus("EURUSD", now);
}

/** Symbol-aware open check (metals honour their daily maintenance break). */
export function isForexMarketOpen(symbol: string, now: Date = new Date()): boolean {
  return isMarketOpenAt(symbol, now.getTime());
}
