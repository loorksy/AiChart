/**
 * Global trading-session awareness — "which session is it right now?".
 *
 * The agent must know WHICH session it is speaking inside — Sydney, Tokyo,
 * London, New York, or an overlap — because liquidity, spreads and the
 * character of moves differ by session, and an analyst who cannot name the
 * session reads as a script. This module answers that question from wall
 * clocks, not fixed UTC offsets: London and New York shift with DST (and
 * Sydney with its own, opposite-hemisphere DST), so each center's hours are
 * evaluated in its OWN IANA time zone and the conversion carries the DST rule
 * with it. Nothing here fetches anything; it is pure time arithmetic.
 *
 * Session windows are each center's institutional trading day in LOCAL time —
 * the convention behind every session clock:
 *   Sydney   07:00–16:00 Australia/Sydney
 *   Tokyo    09:00–18:00 Asia/Tokyo
 *   London   08:00–17:00 Europe/London
 *   New York 08:00–17:00 America/New_York
 *
 * This is deliberately separate from lib/markets/tradingCalendar.ts, which
 * answers a different question ("may an order fill right now?" — weekend and
 * maintenance gates). A center can be inside its session while the retail
 * book is on a maintenance break; the calendar owns tradability, this module
 * owns narrative and analysis context.
 */

export type TradingSessionName = "sydney" | "tokyo" | "london" | "newyork";

export type TradingSessionOverlap =
  | "sydney_tokyo"
  | "tokyo_london"
  | "london_newyork";

export interface TradingSessionInfo {
  /** The instant this was computed for (epoch ms). */
  atMs: number;
  /** Every center currently inside its session window, in canonical order. */
  active: TradingSessionName[];
  /**
   * The session that dominates price action right now. When two overlap the
   * later center leads (its open is the liquidity event): NY > London > Tokyo
   * > Sydney. Null when no center is open (the weekend gap).
   */
  primary: TradingSessionName | null;
  /** The named overlap in effect, when two adjacent centers are both open. */
  overlap: TradingSessionOverlap | null;
  /** The next session to open when none is active; null while any is open. */
  nextOpen: { session: TradingSessionName; inMs: number } | null;
}

const SESSION_WINDOWS: Record<
  TradingSessionName,
  { timeZone: string; openHour: number; closeHour: number }
> = {
  sydney: { timeZone: "Australia/Sydney", openHour: 7, closeHour: 16 },
  tokyo: { timeZone: "Asia/Tokyo", openHour: 9, closeHour: 18 },
  london: { timeZone: "Europe/London", openHour: 8, closeHour: 17 },
  newyork: { timeZone: "America/New_York", openHour: 8, closeHour: 17 },
};

const SESSION_ORDER: TradingSessionName[] = ["sydney", "tokyo", "london", "newyork"];

/** Dominance when sessions overlap — the later center's open leads the tape. */
const PRIMARY_PRIORITY: TradingSessionName[] = ["newyork", "london", "tokyo", "sydney"];

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** One cached formatter per zone — constructing Intl formatters is expensive
 *  and the next-open scan below asks the same four zones hundreds of times. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

function wallClock(timeZone: string, atMs: number): { weekday: number; hour: number; minute: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(atMs));
  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === "weekday") weekday = WEEKDAY_INDEX[part.value] ?? 0;
    else if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }
  return { weekday, hour, minute };
}

/** Is this center inside its session window at this instant (its own clock)? */
export function isSessionOpen(session: TradingSessionName, atMs: number): boolean {
  const window = SESSION_WINDOWS[session];
  const { weekday, hour, minute } = wallClock(window.timeZone, atMs);
  // Weekdays only, in the CENTER's calendar — Sunday 17:00 New York is already
  // Monday morning in Sydney, which is how the week actually opens.
  if (weekday === 0 || weekday === 6) return false;
  const minuteOfDay = hour * 60 + minute;
  return minuteOfDay >= window.openHour * 60 && minuteOfDay < window.closeHour * 60;
}

function overlapOf(active: TradingSessionName[]): TradingSessionOverlap | null {
  const has = (s: TradingSessionName) => active.includes(s);
  if (has("london") && has("newyork")) return "london_newyork";
  if (has("tokyo") && has("london")) return "tokyo_london";
  if (has("sydney") && has("tokyo")) return "sydney_tokyo";
  return null;
}

/** Scan resolution for the next-open search; boundaries are on the hour. */
const SCAN_STEP_MS = 15 * 60_000;
const SCAN_LIMIT_MS = 8 * 24 * 60 * 60_000;

function findNextOpen(
  atMs: number,
): { session: TradingSessionName; inMs: number } | null {
  for (let offset = SCAN_STEP_MS; offset <= SCAN_LIMIT_MS; offset += SCAN_STEP_MS) {
    for (const session of SESSION_ORDER) {
      if (isSessionOpen(session, atMs + offset)) {
        return { session, inMs: offset };
      }
    }
  }
  return null;
}

export function getTradingSessionInfo(nowMs: number = Date.now()): TradingSessionInfo {
  const active = SESSION_ORDER.filter((session) => isSessionOpen(session, nowMs));
  const primary =
    PRIMARY_PRIORITY.find((session) => active.includes(session)) ?? null;
  return {
    atMs: nowMs,
    active,
    primary,
    overlap: overlapOf(active),
    nextOpen: active.length === 0 ? findNextOpen(nowMs) : null,
  };
}

const SESSION_LABEL_EN: Record<TradingSessionName, string> = {
  sydney: "Sydney",
  tokyo: "Tokyo",
  london: "London",
  newyork: "New York",
};

const SESSION_CHARACTER_EN: Record<TradingSessionName, string> = {
  sydney: "thin liquidity, ranges and position squaring; moves are small and levels less reliable",
  tokyo: "Asia session; moderate liquidity, JPY pairs and gold accumulation ranges; breakouts often fail",
  london: "highest FX liquidity of the day; real directional moves and stop runs around the open",
  newyork: "US data releases and the deepest gold/USD flow; strong trends and reversals around 16:30–17:00 UTC data",
};

const OVERLAP_LABEL_EN: Record<TradingSessionOverlap, string> = {
  sydney_tokyo: "Sydney/Tokyo overlap",
  tokyo_london: "Tokyo/London overlap",
  london_newyork: "London/New York overlap — the deepest liquidity window of the day",
};

function hoursAndMinutes(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/**
 * The English block the decision models read. States the session as a FACT
 * with its trading character, so analysis and messaging can reference it —
 * and never claims a session the clock does not support.
 */
export function tradingSessionPromptBlock(info: TradingSessionInfo): string {
  if (info.active.length === 0) {
    const next = info.nextOpen
      ? ` Next session: ${SESSION_LABEL_EN[info.nextOpen.session]} opens in ${hoursAndMinutes(info.nextOpen.inMs)}.`
      : "";
    return `Trading session: no major center is open (weekend gap).${next} Frame any plan as conditional on the reopen.`;
  }
  const names = info.active.map((s) => SESSION_LABEL_EN[s]).join(" + ");
  const overlap = info.overlap ? ` (${OVERLAP_LABEL_EN[info.overlap]})` : "";
  const character = info.primary ? ` Character: ${SESSION_CHARACTER_EN[info.primary]}.` : "";
  return `Trading session now: ${names}${overlap}.${character} Reference the session when it matters to the read (liquidity, spreads, typical behaviour); never name a different session.`;
}
