/**
 * Source-level pin for the zones-slide-with-the-candle bug (round two).
 *
 * The profit/loss rectangles were already drawn with two fixed anchors
 * (tvDrawingAdapter), yet the user still saw them slide: every producer of
 * the LIVE recommendation object omitted `created_at` behind an
 * `as Recommendation` cast, so the adapter's anchor fell back to wall-clock
 * "now" — recomputed on every redraw, re-anchoring the zones at the latest
 * candle after each poll hydration, MCP re-draw, and page reload.
 *
 * There is no React harness in this repo, so — like
 * smartChartWorkspaceInit.test.ts — this pins the producers at the source
 * level: every path that hands a recommendation to the chart must route it
 * through `withStableCreatedAt` (or stamp the creation instant it persists),
 * and the adapter must never derive the anchor from render-time "now" for a
 * trade it has already anchored.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC_ROOT = path.join(import.meta.dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(SRC_ROOT, rel), "utf8");

describe("recommendation anchors come from stored creation time, never render-time 'now'", () => {
  it("the workspace stamps created_at when the agent result lands", () => {
    const src = read("components/SmartChartWorkspace.tsx");
    assert.match(
      src,
      /setRecommendation\(\(prev\) =>\s*withStableCreatedAt\(/,
      "handleAgentResult must anchor the recommendation via withStableCreatedAt — a bare cast loses created_at and the zones re-anchor to 'now' on every redraw",
    );
  });

  it("layout hydration preserves or backfills the anchor — the 4s poll must not re-anchor", () => {
    const src = read("hooks/useChartAnalysis.ts");
    assert.match(
      src,
      /keepIfEqual\(prev, withStableCreatedAt\(snapshot\.recommendation \?\? null, prev\)\)/,
      "hydrateFromSnapshot must route the recommendation through withStableCreatedAt",
    );
  });

  it("the analyze API persists the creation instant with the layout it writes", () => {
    const src = read("app/api/agent/market/analyze/route.ts");
    assert.match(
      src,
      /timeframe: interval,[\s\S]{0,400}created_at: new Date\(\)\.toISOString\(\),[\s\S]{0,100}\} as Recommendation\)/,
      "the mapped recommendation saved into the chart layout must carry created_at",
    );
  });

  it("the MCP drawing gateway keeps the stored anchor for a re-written same plan", () => {
    const src = read("app/api/agent/chart/layout/route.ts");
    assert.match(
      src,
      /withStableCreatedAt\(\s*\{ \.\.\.body\.recommendation, symbol \},/,
      "state.recommendation writes must preserve the stored created_at via withStableCreatedAt",
    );
  });

  it("the TV adapter resolves the fallback anchor once per trade and caches it", () => {
    const src = read("lib/chart/tv/tvDrawingAdapter.ts");
    assert.match(
      src,
      /private readonly fallbackAnchorSec = new Map<string, number>\(\)/,
      "legacy payloads without created_at need a sticky per-trade anchor",
    );
    assert.match(
      src,
      /time: this\.anchorSec\(rec, barSec\)/,
      "the position boxes must anchor through anchorSec (created_at, else the cached fallback)",
    );
    assert.doesNotMatch(
      src,
      /time: stableAnchorSec\(/,
      "the per-call wall-clock fallback is the bug — it must not come back",
    );
  });
});
