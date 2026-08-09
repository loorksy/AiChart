/**
 * CFTC Commitments of Traders (Legacy, Futures Only) positioning provider.
 *
 * Weekly speculative-positioning evidence per currency/gold: net
 * non-commercial position, its one-week change, and where the net sits
 * inside its ~3-year range (extremes are where crowded trades live). Reads
 * the CFTC's public Socrata dataset — no API key required.
 *
 * Evidence, not a gate: positioning never decides whether a plan exists.
 */
import { fetchWithTimeout } from "@/lib/externalFetch";
import { FEATURES } from "@/lib/agent/featureFlags";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent.macro.cot");

const BASE_URL = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";
/** The report lands once a week (Friday) — half a day of staleness is fresh. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** ~3 years of weekly reports for the extremity range. */
const HISTORY_REPORTS = 156;

/** Currency → the contract name prefix in the legacy dataset. */
const MARKETS: Record<string, string> = {
  EUR: "EURO FX",
  GBP: "BRITISH POUND",
  JPY: "JAPANESE YEN",
  CHF: "SWISS FRANC",
  CAD: "CANADIAN DOLLAR",
  AUD: "AUSTRALIAN DOLLAR",
  NZD: "NZ DOLLAR",
  USD: "USD INDEX",
  XAU: "GOLD",
};

export interface CotPositioning {
  currency: string;
  market: string;
  /** Non-commercial longs − shorts, contracts. */
  netNonCommercial: number;
  /** Change vs the previous weekly report. */
  weeklyChange: number | null;
  /** Where the net sits in its ~3y range: 0 = record short, 1 = record long. */
  rangePosition: number | null;
  /** extreme_long / extreme_short when in the outer decile of the range;
   *  "unknown" when the history is too short to place the net at all —
   *  absence of a range read is reported as absence, never as "neutral". */
  extremity: "extreme_long" | "extreme_short" | "neutral" | "unknown";
  reportDate: string;
}

interface CotRow {
  market_and_exchange_names?: unknown;
  report_date_as_yyyy_mm_dd?: unknown;
  noncomm_positions_long_all?: unknown;
  noncomm_positions_short_all?: unknown;
}

interface CacheEntry {
  fetchedAt: number;
  byCurrency: Map<string, CotPositioning>;
}

let cache: CacheEntry | null = null;

function toNet(row: CotRow): { date: string; net: number; name: string } | null {
  const long = Number(row.noncomm_positions_long_all);
  const short = Number(row.noncomm_positions_short_all);
  const date = String(row.report_date_as_yyyy_mm_dd ?? "");
  const name = String(row.market_and_exchange_names ?? "").trim();
  if (!Number.isFinite(long) || !Number.isFinite(short) || !date || !name) return null;
  return { date: date.slice(0, 10), net: long - short, name };
}

async function fetchMarketSeries(marketPrefix: string): Promise<
  { date: string; net: number }[]
> {
  const where = encodeURIComponent(
    `starts_with(market_and_exchange_names, '${marketPrefix}')`,
  );
  const url =
    `${BASE_URL}?$where=${where}` +
    `&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=${HISTORY_REPORTS}`;
  const res = await fetchWithTimeout(url, { method: "GET" }, { label: "CFTC COT" });
  if (!res.ok) throw new Error(`COT request failed for ${marketPrefix}: ${res.status}`);
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows)) {
    throw new Error(`COT returned an unexpected shape for ${marketPrefix}.`);
  }
  const parsed = (rows as CotRow[])
    .map(toNet)
    .filter((entry): entry is { date: string; net: number; name: string } => entry !== null);

  // A prefix can match MORE than one listed contract — 'EURO FX' also matches
  // the 'EURO FX/BRITISH POUND XRATE' cross-rate. Mixing them into one series
  // corrupts the weekly change and the range, so the series is built from ONE
  // exact contract name: the dominant one (most reports; ties broken by which
  // holds the newest report). One market, one time series.
  const byName = new Map<string, { date: string; net: number }[]>();
  for (const entry of parsed) {
    const group = byName.get(entry.name) ?? [];
    group.push({ date: entry.date, net: entry.net });
    byName.set(entry.name, group);
  }
  let dominant: { date: string; net: number }[] = [];
  let dominantNewest = "";
  for (const group of byName.values()) {
    const newest = group[0]?.date ?? "";
    if (
      group.length > dominant.length ||
      (group.length === dominant.length && newest > dominantNewest)
    ) {
      dominant = group;
      dominantNewest = newest;
    }
  }
  return dominant;
}

function buildPositioning(
  currency: string,
  market: string,
  series: { date: string; net: number }[],
): CotPositioning | null {
  if (!series.length) return null;
  const newest = series[0]!;
  const previous = series[1] ?? null;
  let rangePosition: number | null = null;
  if (series.length >= 26) {
    const nets = series.map((s) => s.net);
    const min = Math.min(...nets);
    const max = Math.max(...nets);
    rangePosition =
      max > min ? Math.round(((newest.net - min) / (max - min)) * 1000) / 1000 : 0.5;
  }
  return {
    currency,
    market,
    netNonCommercial: newest.net,
    weeklyChange: previous ? newest.net - previous.net : null,
    rangePosition,
    extremity:
      rangePosition == null
        ? "unknown"
        : rangePosition >= 0.9
          ? "extreme_long"
          : rangePosition <= 0.1
            ? "extreme_short"
            : "neutral",
    reportDate: newest.date,
  };
}

/**
 * Positioning for the currencies a symbol touches (e.g. ["EUR","USD"] or
 * ["XAU","USD"]). Null when the flag is off or every relevant market failed —
 * the bundle then has no positioning entry, never an estimated one. A single
 * market failing drops only that market.
 */
export async function getCotPositioning(
  currencies: string[],
): Promise<CotPositioning[] | null> {
  if (!FEATURES.cotEvidenceV1()) return null;
  const wanted = [...new Set(currencies.map((c) => c.toUpperCase()))].filter(
    (c) => MARKETS[c],
  );
  if (!wanted.length) return null;

  if (!cache || Date.now() - cache.fetchedAt >= CACHE_TTL_MS) {
    cache = { fetchedAt: Date.now(), byCurrency: new Map() };
  }

  const results: CotPositioning[] = [];
  let anyFailure = false;
  for (const currency of wanted) {
    const cached = cache.byCurrency.get(currency);
    if (cached) {
      results.push(cached);
      continue;
    }
    try {
      const series = await fetchMarketSeries(MARKETS[currency]!);
      const positioning = buildPositioning(currency, MARKETS[currency]!, series);
      if (positioning) {
        cache.byCurrency.set(currency, positioning);
        results.push(positioning);
      }
    } catch (error) {
      anyFailure = true;
      log.warn("cot positioning unavailable", {
        currency,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // Nothing usable — whether from failures or an empty dataset — is an
  // honest "no positioning evidence", never an empty-but-present block.
  void anyFailure;
  if (!results.length) return null;
  return results;
}

/** Test hook: clear the module cache between test cases. */
export function clearCotCache(): void {
  cache = null;
}
