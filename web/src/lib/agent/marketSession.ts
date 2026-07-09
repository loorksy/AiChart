/**
 * Forex/metals market-session check. The spot FX week runs from Sunday ~22:00
 * UTC to Friday ~22:00 UTC. This is a coarse gate used to (a) accept stale
 * candles on weekends and (b) block execution when the market is closed. It is
 * intentionally conservative and does NOT model exchange holidays.
 */
export interface MarketSessionStatus {
  isOpen: boolean;
  reason: string;
  nextOpenTime?: string;
}

/** UTC open/close boundaries of the FX week (hours). */
const FRIDAY_CLOSE_UTC_HOUR = 22;
const SUNDAY_OPEN_UTC_HOUR = 22;

export function getForexSessionStatus(now: Date = new Date()): MarketSessionStatus {
  const day = now.getUTCDay(); // 0 = Sun … 6 = Sat
  const hour = now.getUTCHours();

  // Saturday: always closed.
  if (day === 6) {
    return { isOpen: false, reason: "عطلة نهاية الأسبوع — السوق مغلق (السبت)." };
  }
  // Friday after close.
  if (day === 5 && hour >= FRIDAY_CLOSE_UTC_HOUR) {
    return { isOpen: false, reason: "أغلق السوق ليوم الجمعة." };
  }
  // Sunday before open.
  if (day === 0 && hour < SUNDAY_OPEN_UTC_HOUR) {
    return { isOpen: false, reason: "لم يفتح السوق بعد (الأحد)." };
  }
  return { isOpen: true, reason: "السوق مفتوح." };
}

/** Boolean convenience wrapper. Non-FX symbols default to open (24/7 feeds). */
export function isForexMarketOpen(_symbol: string, now: Date = new Date()): boolean {
  return getForexSessionStatus(now).isOpen;
}
