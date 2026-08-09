/**
 * Forex Factory weekly-calendar provider. Reads the public weekly feed the
 * site itself publishes (no API key), maps its impact ratings onto the
 * platform scale, and applies the same honesty rules as every other source:
 * defensive parsing, bounded fetch, short cache, and a thrown error on any
 * upstream failure so the News Agent degrades to newsRisk=unknown — never
 * fake events.
 *
 * The feed is an UNOFFICIAL convenience published by the calendar's CDN; its
 * absence or a schema drift must never take the platform down, which is why
 * every row is validated field by field and invalid rows are dropped, not
 * guessed at.
 */
import { fetchWithTimeout } from "@/lib/externalFetch";
import {
  eventMatchesRequest,
  type EconomicEvent,
  type NewsProvider,
} from "../newsProvider";

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
/** The feed republishes a handful of times per hour; 10 minutes is fresh
 *  enough for a 6-hour risk window without hammering the CDN. */
const CACHE_TTL_MS = 10 * 60 * 1000;

interface FfRow {
  title?: unknown;
  country?: unknown;
  date?: unknown;
  impact?: unknown;
}

interface CacheEntry {
  fetchedAt: number;
  events: EconomicEvent[];
}

let cache: CacheEntry | null = null;

function mapImpact(raw: unknown): EconomicEvent["impact"] {
  const v = String(raw ?? "").toLowerCase();
  if (v.includes("high")) return "high";
  if (v.includes("medium") || v.includes("moderate")) return "medium";
  // "Low", "Holiday", "Non-Economic", and anything unrecognized read as low —
  // the honest floor for an event we cannot grade.
  return "low";
}

function mapRow(row: FfRow): EconomicEvent | null {
  if (typeof row.title !== "string" || !row.title.trim()) return null;
  if (typeof row.date !== "string") return null;
  const time = new Date(row.date);
  if (!Number.isFinite(time.getTime())) return null;
  // In this feed `country` carries the CURRENCY code ("USD", "EUR", …).
  const currency =
    typeof row.country === "string" && row.country.trim().length === 3
      ? row.country.trim().toUpperCase()
      : undefined;
  return {
    title: row.title.trim(),
    time: time.toISOString(),
    impact: mapImpact(row.impact),
    currency,
  };
}

export function createForexFactoryProvider(): NewsProvider {
  return {
    async getEconomicEvents(input: {
      currencies: string[];
      from: Date;
      to: Date;
    }): Promise<EconomicEvent[]> {
      let all: EconomicEvent[];
      if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        all = cache.events;
      } else {
        const res = await fetchWithTimeout(
          FEED_URL,
          { method: "GET" },
          { label: "Forex Factory calendar" },
        );
        if (!res.ok) {
          throw new Error(`Forex Factory calendar request failed: ${res.status}`);
        }
        const rows = (await res.json()) as unknown;
        if (!Array.isArray(rows)) {
          throw new Error("Forex Factory calendar returned an unexpected shape.");
        }
        all = (rows as FfRow[])
          .map(mapRow)
          .filter((event): event is EconomicEvent => event !== null);
        cache = { fetchedAt: Date.now(), events: all };
      }
      return all.filter((event) => eventMatchesRequest(event, input));
    },
  };
}

/** Test hook: clear the module cache between test cases. */
export function clearForexFactoryCache(): void {
  cache = null;
}
