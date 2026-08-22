/**
 * Financial Modeling Prep economic-calendar provider. Wires the honest
 * NewsProvider contract to a real upstream: events are fetched, filtered to
 * the requested currencies, and mapped to the platform's impact scale. Any
 * upstream failure surfaces as a thrown error so the News Agent degrades to
 * newsRisk=unknown — never fake events.
 *
 * Caching lives ONE level up, in the platform calendar cache (calendarCache.ts)
 * that every getNewsProvider() consumer goes through — a provider-local cache
 * here would silently defeat its adaptive near-event refresh.
 */
import { fetchWithTimeout } from "@/lib/externalFetch";
import {
  eventMatchesRequest,
  type EconomicEvent,
  type NewsProvider,
} from "../newsProvider";

const BASE_URL = "https://financialmodelingprep.com/api/v3/economic_calendar";

interface FmpCalendarRow {
  date?: string;
  event?: string;
  country?: string;
  currency?: string;
  impact?: string;
}

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
      const url = `${BASE_URL}?from=${fromStr}&to=${toStr}&apikey=${encodeURIComponent(apiKey)}`;
      const res = await fetchWithTimeout(url, { method: "GET" });
      if (!res.ok) {
        throw new Error(`FMP calendar request failed: ${res.status}`);
      }
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows)) {
        throw new Error("FMP calendar returned an unexpected shape.");
      }
      const all = (rows as FmpCalendarRow[])
        .filter((r) => r.date && r.event)
        .map((r) => ({
          title: String(r.event),
          time: new Date(String(r.date)).toISOString(),
          impact: mapImpact(r.impact),
          currency: rowCurrency(r),
        }));

      // One shared relevance rule for every calendar source (window +
      // currencies + the gold-terms extension) — sources must not drift apart.
      return all.filter((event) => eventMatchesRequest(event, input));
    },
  };
}
