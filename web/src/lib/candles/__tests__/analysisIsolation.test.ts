/**
 * Structural regression guard for the OANDA analysis-only data source (plan
 * "إعادة OANDA كمصدر بيانات تحليلي فقط"). The safety property this plan
 * depends on is: the visual chart and Lonora's live decision path must NEVER
 * see an OANDA-sourced candle. That property is designed to hold because
 * those files simply never import `analysisCandleRepository.ts` or
 * `@/lib/markets/oanda.ts` — this test turns that into a permanent,
 * CI-enforced invariant instead of a one-time manual audit, so a future edit
 * that adds such an import anywhere in this list fails the build immediately
 * rather than silently reopening the leak.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+["']@\/lib\/candles\/analysisCandleRepository["']/,
  /from\s+["']\.\.?\/.*analysisCandleRepository["']/,
  /from\s+["']@\/lib\/markets\/oanda["']/,
  /from\s+["']\.\.?\/.*\/markets\/oanda["']/,
  // `analysisCandleFeed.ts` is the read-side wrapper around the two modules
  // above. Guarding only the two let an OANDA series reach `get_ohlc`
  // through the wrapper — raw candles a client can plot as a chart. Any file
  // below must be unreachable from OANDA by EVERY route, wrapper included.
  /from\s+["']@\/lib\/markets\/analysisCandleFeed["']/,
  /from\s+["']\.\.?\/.*\/markets\/analysisCandleFeed["']/,
];

const MUST_STAY_CHART_OR_LIVE_ONLY = [
  "src/lib/candles/warehouseOhlc.ts",
  "src/app/api/market/klines/route.ts",
  // Raw plottable candles. `show_live_chart` renders this tool's output as a
  // visual candle card, so "the chart" is not just the /chart page — an
  // analysis fallback here IS an OANDA chart. Derived-number tools
  // (get_forex_indicators, scan_market, detect_levels, detect_market_regime)
  // may still fall back; they return analysis results, not a drawable series.
  "src/app/api/agent/market/ohlc/route.ts",
  "src/lib/chartSnapshot.ts",
  "src/lib/chart/multiTimeframeCapture.ts",
  "src/lib/agent/orchestrator.ts",
  "src/lib/recommendations/recommendationTracker.ts",
  "src/lib/markets/marketDataSource.ts",
  "src/lib/ohlc/fetchOhlc.ts",
];

function marketContextFiles(): string[] {
  const dir = join(REPO_ROOT, "src/lib/agent/marketContext");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join("src/lib/agent/marketContext", name));
}

describe("OANDA analysis-source isolation", () => {
  const protectedFiles = [...MUST_STAY_CHART_OR_LIVE_ONLY, ...marketContextFiles()];

  for (const relativePath of protectedFiles) {
    it(`${relativePath} never imports the OANDA analysis path`, () => {
      const content = readFileSync(join(REPO_ROOT, relativePath), "utf-8");
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        assert.equal(
          pattern.test(content),
          false,
          `${relativePath} must never import analysisCandleRepository.ts or markets/oanda.ts — the chart and Lonora's live decision math must only ever see the user's own linked MetaTrader account.`,
        );
      }
    });
  }

  it("covers at least the marketContext directory and the named chart/live files", () => {
    // A cheap sanity check on the guard itself: if this drops to a tiny
    // number, the glob above silently broke (e.g. an empty directory read)
    // and the test suite above would be vacuously passing.
    assert.ok(protectedFiles.length >= MUST_STAY_CHART_OR_LIVE_ONLY.length + 5);
  });
});
