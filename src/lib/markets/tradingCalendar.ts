/**
 * Trading calendar — the ONE place that answers "is this instrument's market
 * open at this instant" and "should a daily bar exist at this open time".
 *
 * The FX/metals week is defined by New York WALL TIME, not fixed UTC hours:
 * the week opens Sunday 17:00 America/New_York and closes Friday 17:00
 * America/New_York. A fixed 22:00-UTC boundary is wrong for half the year
 * (17:00 NY = 21:00 UTC during EDT), which fabricated a phantom "missing"
 * daily bar every week and blocked analysis on perfectly healthy series.
 *
 * Metals (XAU/XAG) additionally observe the daily maintenance break: the feed
 * halts [17:00, 18:00) NY every weekday. The previous session model ignored
 * the symbol entirely, so every gold intraday series reported 4 phantom
 * missing 15m bars per day and analysis was permanently "gapped".
 *
 * Exchange holidays are intentionally NOT modelled (same stance as before) —
 * a missed holiday shows up as a small gap, and the ratio-based gap policy in
 * dataQualityPolicy tolerates it instead of blocking.
 *
 * Kept dependency-free: New York wall time comes from Intl.DateTimeFormat.
 * DST transitions land exactly on UTC hour boundaries (2:00 EST = 07:00 UTC,
 * 2:00 EDT = 06:00 UTC), so the NY weekday+hour is constant within any UTC
 * hour and can be memoized per hour bucket. NY offsets are whole hours, so
 * minutes never shift.
 */
import { forexCanonicalKey } from "./forexCanonical";

export type TradingClass = "fx" | "metal" | "crypto" | "unknown";

export interface TradingSessionStatus {
  isOpen: boolean;
  reason: string;
}

const NY_TIMEZONE = "America/New_York";
/** FX week: Sunday open and Friday close, NY wall clock hour. */
const WEEK_OPEN_HOUR_NY = 17;
const WEEK_CLOSE_HOUR_NY = 17;
/** Metals feed halts [17:00, 18:00) NY each weekday (CME maintenance). */
const METAL_BREAK_START_HOUR_NY = 17;
/** Metals reopen Sunday one hour after FX (18:00 NY, exchange open). */
const METAL_SUNDAY_OPEN_HOUR_NY = 18;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const nyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TIMEZONE,
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

interface NyWallHour {
  weekday: number;
  hour: number;
}

/** Memoized per UTC hour — exact, because DST shifts on UTC hour boundaries. */
const wallHourCache = new Map<number, NyWallHour>();
const WALL_CACHE_LIMIT = 20_000;

function nyWallHour(ms: number): NyWallHour {
  const bucket = Math.floor(ms / 3_600_000);
  const cached = wallHourCache.get(bucket);
  if (cached) return cached;

  const parts = nyFormatter.formatToParts(bucket * 3_600_000);
  let weekday = 0;
  let hour = 0;
  for (const part of parts) {
    if (part.type === "weekday") weekday = WEEKDAY_INDEX[part.value] ?? 0;
    else if (part.type === "hour") hour = Number(part.value) % 24;
  }
  const wall: NyWallHour = { weekday, hour };
  if (wallHourCache.size >= WALL_CACHE_LIMIT) wallHourCache.clear();
  wallHourCache.set(bucket, wall);
  return wall;
}

/** Classify an instrument for session rules. Unknown behaves like fx (conservative). */
export function resolveTradingClass(symbol: string): TradingClass {
  const canonical = forexCanonicalKey(symbol);
  if (!canonical) return "unknown";
  if (canonical.startsWith("XAU") || canonical.startsWith("XAG")) return "metal";
  if (/^(BTC|ETH|SOL|XRP|DOGE|ADA|LTC|BNB)/.test(canonical)) return "crypto";
  if (/^[A-Z]{6}$/.test(canonical)) return "fx";
  return "unknown";
}

/** Optional FX daily-break minutes after 17:00 NY (some brokers halt fx too). */
function fxBreakMinutes(): number {
  const raw = Number(process.env.TRADING_CALENDAR_FX_BREAK_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(Math.floor(raw), 60);
}

/**
 * Is the instrument's market open at this instant?
 *
 * fx:    Sun 17:00 NY → Fri 17:00 NY, optional env-configured break.
 * metal: Sun 18:00 NY → Fri 17:00 NY, halted [17:00, 18:00) NY Mon–Thu.
 * crypto: always open.
 */
export function isMarketOpenAt(symbol: string, ms: number): boolean {
  const tradingClass = resolveTradingClass(symbol);
  if (tradingClass === "crypto") return true;

  const { weekday, hour } = nyWallHour(ms);

  // Weekend shared by fx and metals.
  if (weekday === 6) return false;
  if (weekday === 5 && hour >= WEEK_CLOSE_HOUR_NY) return false;

  if (tradingClass === "metal") {
    if (weekday === 0 && hour < METAL_SUNDAY_OPEN_HOUR_NY) return false;
    // Daily maintenance break Mon–Thu (Fri ≥17 already closed above).
    if (hour === METAL_BREAK_START_HOUR_NY) return false;
    return true;
  }

  // fx / unknown
  if (weekday === 0 && hour < WEEK_OPEN_HOUR_NY) return false;
  const breakMinutes = fxBreakMinutes();
  if (breakMinutes > 0 && hour === WEEK_CLOSE_HOUR_NY && weekday >= 1) {
    const minute = new Date(ms).getUTCMinutes(); // NY offsets are whole hours
    if (minute < breakMinutes) return false;
  }
  return true;
}

/**
 * Should a DAILY bar exist at this open timestamp?
 *
 * Forex daily candles are aligned to 17:00 America/New_York regardless of
 * DST, giving exactly five bars per normal week (Sun–Thu opens covering the
 * Mon–Fri sessions). Walking "previous + 24h" through isMarketOpenAt cannot
 * express that — the 24h step drifts an hour across each DST transition and
 * the old fixed-UTC check then declared a weekly phantom gap.
 */
export function isExpectedDailyBarOpen(symbol: string, openMs: number): boolean {
  if (resolveTradingClass(symbol) === "crypto") return true;
  const { weekday, hour } = nyWallHour(openMs);
  return hour === WEEK_OPEN_HOUR_NY && weekday >= 0 && weekday <= 4;
}

/** Session status with the operator-facing Arabic reason (same shape as before). */
export function getSessionStatus(
  symbol: string,
  now: Date = new Date(),
): TradingSessionStatus {
  const ms = now.getTime();
  if (isMarketOpenAt(symbol, ms)) {
    return { isOpen: true, reason: "السوق مفتوح." };
  }

  const { weekday, hour } = nyWallHour(ms);
  if (weekday === 6) {
    return { isOpen: false, reason: "عطلة نهاية الأسبوع — السوق مغلق (السبت)." };
  }
  if (weekday === 5 && hour >= WEEK_CLOSE_HOUR_NY) {
    return { isOpen: false, reason: "أغلق السوق ليوم الجمعة." };
  }
  if (weekday === 0) {
    return { isOpen: false, reason: "لم يفتح السوق بعد (الأحد)." };
  }
  return {
    isOpen: false,
    reason: "استراحة الصيانة اليومية — يعود التداول خلال ساعة.",
  };
}

/** Test hook: NY weekday/hour for a timestamp (exact, DST-aware). */
export function nyWallHourForTest(ms: number): NyWallHour {
  return nyWallHour(ms);
}
