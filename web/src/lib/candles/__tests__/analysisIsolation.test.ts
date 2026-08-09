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

/**
 * Every module that constitutes "reaching OANDA".
 *
 * `analysisCandleFeed.ts` and `oandaBackfillService.ts` are wrappers around
 * the other two. Guarding only the leaf modules is what let an OANDA series
 * reach `get_ohlc` — raw candles a client can plot as a chart — through the
 * feed wrapper without tripping anything.
 */
const FORBIDDEN_MODULES = [
  "@/lib/candles/analysisCandleRepository",
  "@/lib/candles/oandaBackfillService",
  "@/lib/markets/oanda",
  "@/lib/markets/analysisCandleFeed",
];

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches BOTH `from "x"` and `await import("x")`, via the `@/` alias or a
 * relative path. The dynamic form is not hypothetical or defensive: it is the
 * form actually used to reach this code (`research/warehouse.ts` does
 * `await import("@/lib/candles/analysisCandleRepository")`), so a static-only
 * guard would miss the one call shape that exists in the tree today.
 *
 * The trailing quote is inside each alternative on purpose, so the pattern for
 * `markets/oanda` cannot also match `markets/oandaBackfillService`.
 */
function forbiddenPatterns(): RegExp[] {
  const REACH = `(?:from|import\\s*\\()\\s*["']`;
  return FORBIDDEN_MODULES.flatMap((alias) => {
    const leaf = escapeRe(alias.split("/").pop()!);
    return [
      new RegExp(`${REACH}${escapeRe(alias)}["']`),
      new RegExp(`${REACH}\\.{1,2}(?:/[^"']*)?/${leaf}["']`),
    ];
  });
}

const FORBIDDEN_IMPORT_PATTERNS = forbiddenPatterns();

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

  /**
   * The guard itself must be able to fail. A pattern list that matches
   * nothing would let every check above pass while protecting nothing — and
   * that is not a theoretical worry here: the `get_ohlc` leak reached OANDA
   * through a wrapper none of the original patterns named, so the suite went
   * green over a live leak. Each sample below is a real call shape.
   */
  const MUST_BE_CAUGHT = [
    `import { getAnalysisCandles } from "@/lib/candles/analysisCandleRepository";`,
    `import { fetchOandaCandles } from "@/lib/markets/oanda";`,
    `import { fetchAnalysisCandleFeed } from "@/lib/markets/analysisCandleFeed";`,
    `import { triggerAnalysisBackfill } from "@/lib/candles/oandaBackfillService";`,
    `const { getAnalysisCandles } = await import("@/lib/candles/analysisCandleRepository");`,
    `await import("@/lib/candles/oandaBackfillService")`,
    `import { fetchAnalysisCandleFeed } from "../../markets/analysisCandleFeed";`,
    `import { oandaConfigured } from "./markets/oanda";`,
  ];

  for (const sample of MUST_BE_CAUGHT) {
    it(`the guard actually rejects: ${sample.slice(0, 62)}…`, () => {
      assert.ok(
        FORBIDDEN_IMPORT_PATTERNS.some((pattern) => pattern.test(sample)),
        `no forbidden pattern matched \`${sample}\` — the guard would pass over this leak`,
      );
    });
  }

  it("the guard does not over-match a neighbouring module name", () => {
    // `markets/oanda` must not also swallow `candles/oandaBackfillService`'s
    // own entry, and neither may match an unrelated file that merely starts
    // with the same letters.
    const benign = `import { oandaSpreadLabel } from "@/lib/markets/oandaLabels";`;
    assert.equal(
      FORBIDDEN_IMPORT_PATTERNS.some((pattern) => pattern.test(benign)),
      false,
    );
  });

  it("covers at least the marketContext directory and the named chart/live files", () => {
    // A cheap sanity check on the guard itself: if this drops to a tiny
    // number, the glob above silently broke (e.g. an empty directory read)
    // and the test suite above would be vacuously passing.
    assert.ok(protectedFiles.length >= MUST_STAY_CHART_OR_LIVE_ONLY.length + 5);
  });
});
