/**
 * Platform-level economic-calendar cache — the calendar is a SCHEDULE, not a
 * price. It changes once or twice a day, so fetching it on every analysis was
 * pure waste (and earned the platform HTTP 429 from the Forex Factory CDN
 * under light load). This module makes the fetch shared and rare while
 * keeping every DECISION live:
 *
 *   - One shared fetch per freshness window, single-flight: concurrent
 *     analyses coalesce onto the same in-flight request instead of racing.
 *   - The cache stores event TIMES only. Distance-to-event is computed at
 *     read time from the server clock, never from fetch time: a snapshot
 *     fetched at 10:00 knows CPI is at 15:30; an analysis at 14:59 sees 31
 *     minutes and may pass, an analysis at 15:01 sees 29 minutes and is
 *     blocked. Same stored data, different verdicts.
 *   - The freshness window ADAPTS: 15 minutes normally, 2 minutes once the
 *     nearest high-impact event is within the next two hours. Both numbers
 *     are configurable (NEWS_CALENDAR_CACHE_TTL_MS / NEWS_CALENDAR_NEAR_TTL_MS).
 *   - Fail-closed is untouched: a fetch failure with a cache older than the
 *     hard maximum (NEWS_CALENDAR_MAX_AGE_MS, default 2 hours) rethrows
 *     exactly like a failure with no cache at all, so the news gate blocks
 *     as it always has. The cache reduces requests; it never launders a
 *     stale calendar into a fresh one.
 */
import {
  eventMatchesRequest,
  type EconomicEvent,
} from "./newsProvider";

const DEFAULT_TTL_MS = 15 * 60_000;
const NEAR_EVENT_TTL_MS = 2 * 60_000;
/** "Near" for the adaptive window: nearest high-impact within two hours. */
const NEAR_EVENT_HORIZON_MS = 2 * 60 * 60_000;
const DEFAULT_MAX_STALE_MS = 2 * 60 * 60_000;

/**
 * The canonical span one fetch covers. Callers ask for narrow windows (a
 * 6-hour analysis horizon, a 60-minute monitor sweep); the platform fetches
 * once, wide, and every reader filters the stored schedule at read time.
 */
const FETCH_PAST_MS = 12 * 60 * 60_000;
const FETCH_FUTURE_MS = 48 * 60 * 60_000;

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < 0) return fallback;
  return Math.floor(raw);
}

export function calendarTtlDefaultMs(): number {
  // A "freshness" window longer than the hard staleness bound would serve a
  // calendar the failure path is required to reject — cap it there.
  return Math.min(envMs("NEWS_CALENDAR_CACHE_TTL_MS", DEFAULT_TTL_MS), calendarMaxStaleMs());
}

export function calendarTtlNearEventMs(): number {
  return Math.min(envMs("NEWS_CALENDAR_NEAR_TTL_MS", NEAR_EVENT_TTL_MS), calendarMaxStaleMs());
}

export function calendarMaxStaleMs(): number {
  return envMs("NEWS_CALENDAR_MAX_AGE_MS", DEFAULT_MAX_STALE_MS);
}

interface CacheEntry {
  fetchedAt: number;
  events: EconomicEvent[];
}

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

export interface CalendarCacheDeps {
  now?: () => number;
  /** The underlying (uncached) calendar read — the merged provider in production. */
  fetch: (input: { currencies: string[]; from: Date; to: Date }) => Promise<EconomicEvent[]>;
  ttlDefaultMs?: number;
  ttlNearEventMs?: number;
  maxStaleMs?: number;
}

/** One cache entry per currency set — a single key in practice (gold only). */
function cacheKey(currencies: string[]): string {
  return [...currencies].map((c) => c.toUpperCase()).sort().join(",");
}

/**
 * The adaptive freshness window, judged from the STORED schedule at read
 * time: once a high-impact print is close, the calendar is re-checked far
 * more often — schedule revisions and late additions matter most there.
 */
function ttlFor(entry: CacheEntry, now: number, deps: CalendarCacheDeps): number {
  const near = entry.events.some((event) => {
    if (event.impact !== "high") return false;
    const dt = new Date(event.time).getTime() - now;
    return dt >= 0 && dt <= NEAR_EVENT_HORIZON_MS;
  });
  return near
    ? (deps.ttlNearEventMs ?? calendarTtlNearEventMs())
    : (deps.ttlDefaultMs ?? calendarTtlDefaultMs());
}

function filterAt(entry: CacheEntry, input: {
  currencies: string[];
  from: Date;
  to: Date;
}): EconomicEvent[] {
  return entry.events.filter((event) => eventMatchesRequest(event, input));
}

export async function getCalendarEvents(
  input: { currencies: string[]; from: Date; to: Date },
  deps: CalendarCacheDeps,
): Promise<EconomicEvent[]> {
  const now = deps.now?.() ?? Date.now();
  const key = cacheKey(input.currencies);
  const entry = entries.get(key);

  if (entry && now - entry.fetchedAt < ttlFor(entry, now, deps)) {
    return filterAt(entry, input);
  }

  let flight = inFlight.get(key);
  if (!flight) {
    flight = (async () => {
      const events = await deps.fetch({
        currencies: input.currencies,
        from: new Date(now - FETCH_PAST_MS),
        to: new Date(now + FETCH_FUTURE_MS),
      });
      const fresh: CacheEntry = { fetchedAt: now, events };
      entries.set(key, fresh);
      return fresh;
    })();
    inFlight.set(key, flight);
    const cleanup = () => {
      if (inFlight.get(key) === flight) inFlight.delete(key);
    };
    flight.then(cleanup, cleanup);
  }

  try {
    const fresh = await flight;
    return filterAt(fresh, input);
  } catch (error) {
    // The fetch failed. A cache still inside the hard staleness bound is a
    // truthful schedule (distances are computed live regardless of its age);
    // beyond that bound the calendar is unknown and the failure propagates,
    // so the news gate blocks exactly as it did before this cache existed.
    if (entry && now - entry.fetchedAt < (deps.maxStaleMs ?? calendarMaxStaleMs())) {
      return filterAt(entry, input);
    }
    throw error;
  }
}

/** Test hook: drop every stored schedule and in-flight fetch. */
export function resetCalendarCacheForTests(): void {
  entries.clear();
  inFlight.clear();
}
