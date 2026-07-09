/**
 * Financial Modeling Prep economic-calendar provider. Wires the honest
 * NewsProvider contract to a real upstream: events are fetched (with a short
 * in-memory cache to respect rate limits), filtered to the requested
 * currencies, and mapped to the platform's impact scale. Any upstream failure
 * surfaces as a thrown error so the News Agent degrades to newsRisk=unknown —
 * never fake events.
 */
import { fetchWithTimeout } from "@/lib/externalFetch";
import type { EconomicEvent, NewsProvider } from "../newsProvider";

const BASE_URL = "https://financialmodelingprep.com/api/v3/economic_calendar";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface FmpCalendarRow {
  date?: string;
  event?: string;
  country?: string;
  currency?: string;
  impact?: string;
}

interface CacheEntry {
  fetchedAt: number;
  events: EconomicEvent[];
}

const cache = new Map<string, CacheEntry>();

/** Country → currency mapping for rows without an explicit currency. */
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD",
  USA: "USD",
  "UNITED STATES": "USD",
  EU: "EUR",
  EMU: "EUR",
  EUROZONE: "EUR",
  "EURO AREA": "EUR",
  DE: "EUR",
  GERMANY: "EUR",
  FR: "EUR",
  FRANCE: "EUR",
  GB: "GBP",
  UK: "GBP",
  "UNITED KINGDOM": "GBP",
  JP: "JPY",
  JAPAN: "JPY",
  CH: "CHF",
  SWITZERLAND: "CHF",
  CA: "CAD",
  CANADA: "CAD",
  AU: "AUD",
  AUSTRALIA: "AUD",
  NZ: "NZD",
  "NEW ZEALAND": "NZD",
};

/** Terms that matter for gold (XAU) beyond plain USD events. */
const GOLD_TERMS =
  /fed|fomc|cpi|nfp|non[- ]?farm|payroll|inflation|interest rate|yield|treasury|powell|pce/i;

function mapImpact(raw: string | undefined): EconomicEvent["impact"] {
  const v = (raw ?? "").toLowerCase();
  if (v.includes("high") || v === "3") return "high";
  if (v.includes("medium") || v.includes("moderate") || v === "2") return "medium";
  return "low";
}

function rowCurrency(row: FmpCalendarRow): string | undefined {
  if (row.currency && row.currency.length === 3) return row.currency.toUpperCase();
  const country = (row.country ?? "").toUpperCase().trim();
  return COUNTRY_CURRENCY[country];
}

export function createFmpProvider(apiKey: string): NewsProvider {
  return {
    async getEconomicEvents(input: {
      currencies: string[];
      from: Date;
      to: Date;
    }): Promise<EconomicEvent[]> {
      const fromStr = input.from.toISOString().slice(0, 10);
      const toStr = input.to.toISOString().slice(0, 10);
      const cacheKey = `${fromStr}:${toStr}`;

      let all: EconomicEvent[];
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        all = cached.events;
      } else {
        const url = `${BASE_URL}?from=${fromStr}&to=${toStr}&apikey=${encodeURIComponent(apiKey)}`;
        const res = await fetchWithTimeout(url, { method: "GET" });
        if (!res.ok) {
          throw new Error(`FMP calendar request failed: ${res.status}`);
        }
        const rows = (await res.json()) as unknown;
        if (!Array.isArray(rows)) {
          throw new Error("FMP calendar returned an unexpected shape.");
        }
        all = (rows as FmpCalendarRow[])
          .filter((r) => r.date && r.event)
          .map((r) => ({
            title: String(r.event),
            time: new Date(String(r.date)).toISOString(),
            impact: mapImpact(r.impact),
            currency: rowCurrency(r),
          }));
        cache.set(cacheKey, { fetchedAt: Date.now(), events: all });
      }

      const wanted = new Set(input.currencies.map((c) => c.toUpperCase()));
      const wantsGold = wanted.has("XAU");
      const fromMs = input.from.getTime();
      const toMs = input.to.getTime();

      return all.filter((e) => {
        const t = new Date(e.time).getTime();
        if (!(t >= fromMs && t <= toMs)) return false;
        if (e.currency && wanted.has(e.currency)) return true;
        // Gold: USD events + Fed/CPI/NFP/FOMC/yields/inflation terms.
        if (wantsGold) {
          if (e.currency === "USD") return true;
          if (GOLD_TERMS.test(e.title)) return true;
        }
        return false;
      });
    },
  };
}

/** Test hook: clear the module cache between test cases. */
export function clearFmpCache(): void {
  cache.clear();
}
