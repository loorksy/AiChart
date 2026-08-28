/**
 * Clear-drawings must empty analysis drawings AND stop painting the system
 * P/L box / S/R overlays on the live workspace chart. The recommendation
 * record stays in the DB; the report/detail chart still paints it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import {
  clearAnalysisPresentation,
  liveChartApplyArgs,
  overlaysToDrawings,
  shouldPaintTradeOverlay,
} from "@/lib/chart/drawings/clearAnalysisPresentation";
import { keepExplicitUserDrawings, sanitizeAgentDrawings } from "@/lib/agent/drawings/drawingOwnership";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { ChartOverlay } from "@/lib/chartOverlays";
import type { Recommendation } from "@/lib/types";

const SRC_ROOT = path.join(import.meta.dirname, "../../../../../");
const read = (rel: string) => readFileSync(path.join(SRC_ROOT, rel), "utf8");

const REC = {
  action: "buy",
  entry: 2640,
  stop_loss: 2630,
  take_profit: 2660,
} as unknown as Recommendation;

const SR_OVERLAYS: ChartOverlay[] = [
  { price: 2650, type: "resistance", label: "مقاومة" },
  { price: 2620, type: "support", label: "دعم" },
];

function agentLine(price: number, label: string): ChartDrawing {
  return sanitizeAgentDrawings(
    [{ type: "price_line", confidence: 70, label, points: [{ price }] }],
    { analysisId: "a1" },
  )[0]!;
}

describe("clearAnalysisPresentation", () => {
  it("drops agent drawings and every overlay, and flags the live chart cleared", () => {
    const user: ChartDrawing = {
      type: "trend_line",
      confidence: 100,
      points: [{ price: 2600 }, { price: 2610 }],
      meta: { owner: "user" },
    };
    const unstampedSr: ChartDrawing = {
      type: "price_line",
      confidence: 80,
      label: "مقاومة",
      points: [{ price: 2650 }],
    };
    const cleared = clearAnalysisPresentation([
      user,
      agentLine(2640, "دخول"),
      unstampedSr,
    ]);
    assert.equal(cleared.drawings.length, 1);
    assert.equal(cleared.drawings[0], user);
    assert.deepEqual(cleared.overlays, []);
    assert.equal(cleared.drawingsCleared, true);
  });

  it("keepExplicitUserDrawings drops unstamped leftovers (legacy agent S/R)", () => {
    const user: ChartDrawing = {
      type: "trend_line",
      confidence: 100,
      points: [{ price: 1 }],
      meta: { owner: "user" },
    };
    const leftover: ChartDrawing = {
      type: "price_line",
      confidence: 80,
      points: [{ price: 2 }],
    };
    assert.deepEqual(keepExplicitUserDrawings([user, leftover]), [user]);
  });
});

describe("liveChartApplyArgs — workspace clear vs report paint", () => {
  it("cleared live chart empties drawings and does not pass the rec into apply", () => {
    const payload = liveChartApplyArgs({
      overlays: SR_OVERLAYS,
      drawings: [agentLine(2640, "دخول"), agentLine(2630, "وقف خسارة")],
      recommendation: REC,
      targets: [2660],
      drawingsCleared: true,
    });
    assert.deepEqual(payload.drawings, []);
    assert.equal(payload.trade.recommendation, null);
    assert.deepEqual(payload.trade.targets, []);
    assert.equal(payload.opts.paintTradeOverlay, false);
  });

  it("S/R overlays become price_lines only when the live chart is still painting", () => {
    const painted = liveChartApplyArgs({
      overlays: SR_OVERLAYS,
      drawings: [],
      recommendation: REC,
    });
    assert.equal(painted.drawings.length, 2);
    assert.ok(painted.drawings.every((d) => d.type === "price_line"));
    assert.deepEqual(
      painted.drawings.map((d) => d.label),
      ["مقاومة", "دعم"],
    );
    assert.equal(painted.trade.recommendation, REC);

    const cleared = liveChartApplyArgs({
      overlays: SR_OVERLAYS,
      drawings: [],
      recommendation: REC,
      drawingsCleared: true,
    });
    assert.deepEqual(cleared.drawings, []);
    assert.equal(cleared.trade.recommendation, null);
  });

  it("report/detail default still paints the rec overlay (no suppress flag)", () => {
    const payload = liveChartApplyArgs({
      overlays: [],
      drawings: [],
      recommendation: REC,
      targets: [2660, 2670],
    });
    assert.equal(payload.opts.paintTradeOverlay, true);
    assert.equal(payload.trade.recommendation, REC);
    assert.deepEqual(payload.trade.targets, [2660, 2670]);
  });

  it("paintTradeOverlay=false wins even if drawingsCleared is unset", () => {
    assert.equal(
      shouldPaintTradeOverlay({ paintTradeOverlay: false }),
      false,
    );
    const payload = liveChartApplyArgs({
      recommendation: REC,
      overlays: SR_OVERLAYS,
      paintTradeOverlay: false,
    });
    assert.equal(payload.trade.recommendation, null);
    assert.deepEqual(payload.drawings, []);
  });
});

describe("overlaysToDrawings", () => {
  it("maps support/resistance overlays to horizontal price lines", () => {
    const lines = overlaysToDrawings(SR_OVERLAYS);
    assert.equal(lines.length, 2);
    assert.equal(lines[0]!.price, 2650);
    assert.equal(lines[1]!.price, 2620);
    assert.equal(lines[0]!.type, "price_line");
  });
});

describe("live workspace wires the suppress flag; rec pages do not", () => {
  it("handleAgentResult on clear wipes overlays and sets drawingsCleared", () => {
    const src = read("src/components/SmartChartWorkspace.tsx");
    assert.match(
      src,
      /if \(result\.clearAgentDrawings\)/,
      "agent clear must be an explicit branch, not drawings: []",
    );
    assert.match(
      src,
      /clearAnalysisPresentation\(prev\)/,
      "clear must run through clearAnalysisPresentation so overlays + flag stay in lockstep",
    );
    assert.match(src, /setOverlays\(\[\]\)/);
    assert.match(src, /setDrawingsCleared\(true\)/);
    assert.match(
      src,
      /paintTradeOverlay=\{!drawingsCleared\}/,
      "live TvChart must not pass the rec into apply after a clear",
    );
    assert.match(src, /drawingsCleared=\{drawingsCleared\}/);
    assert.match(
      src,
      /drawingsCleared,/,
      "layout autosave must persist the flag so the 4s poll cannot put the box back",
    );
  });

  it("TvChart apply goes through liveChartApplyArgs with the suppress flag", () => {
    const src = read("src/components/chart/TvChart.tsx");
    assert.match(src, /liveChartApplyArgs/);
    assert.match(src, /paintTradeOverlay: payload\.opts\.paintTradeOverlay/);
    assert.match(src, /paintTradeOverlay\?: boolean/);
    assert.doesNotMatch(
      src,
      /const combined = \[\.\.\.overlaysToDrawings/,
      "must not concatenate overlays + rec apply without the suppress helper",
    );
  });

  it("header clear also marks drawingsCleared so the box cannot return from layout rec", () => {
    const src = read("src/hooks/useChartAnalysis.ts");
    assert.match(src, /setDrawingsCleared\(true\)/);
    assert.match(src, /drawingsCleared\?: boolean/);
    assert.match(
      src,
      /setDrawingsCleared\(snapshot\.drawingsCleared === true\)/,
    );
  });

  it("recommendation report/detail still paints P/L from the stored rec", () => {
    const tracked = read("src/app/api/recommendations/tracked/[id]/chart/route.ts");
    assert.match(tracked, /overlaysFromRecommendation/);
    assert.doesNotMatch(tracked, /drawingsCleared/);
    assert.doesNotMatch(tracked, /paintTradeOverlay/);

    const agentChart = read("src/app/api/agent/chart/[id]/route.ts");
    assert.match(agentChart, /overlaysFromRecommendation/);
    assert.doesNotMatch(agentChart, /drawingsCleared/);

    const recChart = read("src/lib/recommendationChart.ts");
    assert.match(recChart, /overlaysFromRecommendation/);
    assert.doesNotMatch(recChart, /drawingsCleared/);
  });

  it("MCP/Telegram clear_chart_drawings wipes overlays and sets the live-chart flag", () => {
    const src = read("src/app/api/agent/chart/layout/route.ts");
    assert.match(src, /body\.mode === "clear"/);
    assert.match(src, /state\.overlays = \[\]/);
    assert.match(src, /state\.drawingsCleared = true/);
    assert.match(
      src,
      /state\.drawingsCleared = false/,
      "a new MCP draw must show the overlay again",
    );
  });
});
