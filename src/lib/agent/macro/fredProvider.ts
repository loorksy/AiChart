/**
 * FRED (Federal Reserve Economic Data) macro-regime provider.
 *
 * Slow-moving policy evidence for the decision engine: where the Fed's rate
 * sits and which way it is drifting, inflation's level and direction, the
 * 2s10s curve, and unemployment. Everything here is a REAL published series
 * observation — trends are computed from the observations themselves, and a
 * missing series is reported missing, never estimated.
 *
 * Evidence, not a gate: the block strengthens or weakens a plan like any
 * other bundle entry (macro regime never decides whether a plan exists).
 */
import { fetchWithTimeout } from "@/lib/externalFetch";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent.macro.fred");

const BASE_URL = "https://api.stlouisfed.org/fred/series/observations";
/** Policy data moves on meeting/print cadence — 6h staleness is fresh. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** The series the regime read rests on. Monthly unless noted. */
const SERIES = {
  /** Effective federal funds rate (daily). */
  policyRate: "DFF",
  /** CPI all items, index level — YoY computed from observations. */
  cpiIndex: "CPIAUCSL",
  /** 2-year and 10-year Treasury yields (daily) for the curve. */
  yield2y: "DGS2",
  yield10y: "DGS10",
  /** Unemployment rate. */
  unemployment: "UNRATE",
} as const;

export interface MacroRegimeBlock {
  /** Effective policy rate, percent. */
  policyRatePct: number;
  /** Rate drift over ~3 months: rising | falling | holding. */
  policyTrend: "rising" | "falling" | "holding";
  /** CPI year-over-year, percent; null when the window is incomplete. */
  inflationYoYPct: number | null;
  inflationTrend: "rising" | "falling" | "holding" | "unknown";
  /** 10y − 2y, percentage points; negative = inverted curve. */
  curveSpreadPct: number | null;
  unemploymentPct: number | null;
  /** ISO date of the newest observation used. */
  asOf: string;
  source: "fred";
}

interface CacheEntry {
  fetchedAt: number;
  block: MacroRegimeBlock;
}

let cache: CacheEntry | null = null;

interface FredObservation {
  date: string;
  value: string;
}

async function fetchSeries(
  apiKey: string,
  seriesId: string,
  limit: number,
): Promise<FredObservation[]> {
  const url =
    `${BASE_URL}?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(apiKey)}&file_type=json` +
    `&sort_order=desc&limit=${limit}`;
  const res = await fetchWithTimeout(url, { method: "GET" }, { label: "FRED" });
  if (!res.ok) throw new Error(`FRED ${seriesId} request failed: ${res.status}`);
  const body = (await res.json()) as { observations?: unknown };
  if (!Array.isArray(body.observations)) {
    throw new Error(`FRED ${seriesId} returned an unexpected shape.`);
  }
  // FRED reports missing datapoints as "." — drop them, never coerce to 0.
  return (body.observations as FredObservation[]).filter(
    (o) => typeof o.value === "string" && o.value !== "." && o.date,
  );
}

function latest(obs: FredObservation[]): number | null {
  const v = Number(obs[0]?.value);
  return Number.isFinite(v) ? v : null;
}

function trendOf(
  newest: number | null,
  older: number | null,
  holdBand: number,
): "rising" | "falling" | "holding" | "unknown" {
  if (newest == null || older == null) return "unknown";
  const delta = newest - older;
  if (delta > holdBand) return "rising";
  if (delta < -holdBand) return "falling";
  return "holding";
}

/**
 * Build the macro regime block, or null when FRED_API_KEY is not configured
 * or the upstream fails — the bundle then simply has no macro entry, and the
 * prompt rule forbids the model claiming it was checked.
 */
export async function getMacroRegime(): Promise<MacroRegimeBlock | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.block;

  const apiKey = await getPlatformValueAsync("FRED_API_KEY");
  if (!apiKey) return null;

  try {
    // ~95 daily points ≈ 3 months for the rate/yields; 14 monthly points give
    // a 13-month CPI window for YoY plus the previous month's YoY for trend.
    const [rate, cpi, y2, y10, unemployment] = await Promise.all([
      fetchSeries(apiKey, SERIES.policyRate, 95),
      fetchSeries(apiKey, SERIES.cpiIndex, 14),
      fetchSeries(apiKey, SERIES.yield2y, 5),
      fetchSeries(apiKey, SERIES.yield10y, 5),
      fetchSeries(apiKey, SERIES.unemployment, 2),
    ]);

    const policyNow = latest(rate);
    if (policyNow == null || !rate[0]) {
      throw new Error("FRED policy-rate series returned no usable observation.");
    }
    const policyOld = Number(rate[rate.length - 1]?.value);
    // 12.5bp over a quarter separates a real move from daily wobble.
    const policyTrend = trendOf(
      policyNow,
      Number.isFinite(policyOld) ? policyOld : null,
      0.125,
    );

    let inflationYoY: number | null = null;
    let inflationTrend: MacroRegimeBlock["inflationTrend"] = "unknown";
    if (cpi.length >= 13) {
      const nowIdx = Number(cpi[0]!.value);
      const yearAgo = Number(cpi[12]!.value);
      if (Number.isFinite(nowIdx) && Number.isFinite(yearAgo) && yearAgo > 0) {
        inflationYoY = Math.round(((nowIdx / yearAgo - 1) * 100) * 100) / 100;
      }
      if (cpi.length >= 14) {
        const prevIdx = Number(cpi[1]!.value);
        const prevYearAgo = Number(cpi[13]!.value);
        if (
          inflationYoY != null &&
          Number.isFinite(prevIdx) &&
          Number.isFinite(prevYearAgo) &&
          prevYearAgo > 0
        ) {
          const prevYoY = (prevIdx / prevYearAgo - 1) * 100;
          inflationTrend = trendOf(inflationYoY, prevYoY, 0.05);
        }
      }
    }

    const spread =
      latest(y10) != null && latest(y2) != null
        ? Math.round((latest(y10)! - latest(y2)!) * 100) / 100
        : null;

    const block: MacroRegimeBlock = {
      policyRatePct: Math.round(policyNow * 100) / 100,
      policyTrend: policyTrend === "unknown" ? "holding" : policyTrend,
      inflationYoYPct: inflationYoY,
      inflationTrend,
      curveSpreadPct: spread,
      unemploymentPct: latest(unemployment),
      asOf: rate[0].date,
      source: "fred",
    };
    cache = { fetchedAt: Date.now(), block };
    return block;
  } catch (error) {
    log.warn("macro regime unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Test hook: clear the module cache between test cases. */
export function clearMacroRegimeCache(): void {
  cache = null;
}
