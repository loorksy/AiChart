import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeometrySnapshot, PatternInstance } from "@/lib/chart/geometry";
import {
  isPatternBoundaryZone,
  patternBoundaryZones,
} from "@/lib/agent/trading/patternBoundaryZones";

/**
 * Forming-pattern boundaries as REAL entry zones (plan §11 F.3).
 *
 * The requirement being enforced: the opportunity must enter the evidence
 * bundle as a candidate the engine validated — not as a sentence in the prompt.
 * A boundary the model can only talk about fails level grounding the moment it
 * tries to plan from it.
 */

function pivot(index: number, price: number, kind: "high" | "low") {
  return { index, time: 1_700_000_000_000 + index * 900_000, price, kind };
}

function formingRectangle(): PatternInstance {
  return {
    patternType: "rectangle",
    status: "forming",
    anchors: [
      pivot(0, 110, "high"),
      pivot(7, 100, "low"),
      pivot(14, 110.2, "high"),
      pivot(21, 99.9, "low"),
    ],
    confidence: 62,
    evidence: [],
  };
}

function snapshot(patterns: PatternInstance[]): GeometrySnapshot {
  return {
    pivots: [],
    trendlines: [],
    channels: [],
    patterns,
    candlesticks: [],
    candleCount: 60,
    atr: 1,
  };
}

describe("pattern boundaries become zones", () => {
  it("offers the floor as demand and the ceiling as supply", () => {
    const zones = patternBoundaryZones(snapshot([formingRectangle()]), 1);
    const demand = zones.find((z) => z.type === "demand");
    const supply = zones.find((z) => z.type === "supply");
    assert.ok(demand && supply, "both boundaries of a rectangle are tradeable");
    // The floor is where longs defend; the anticipatory entry trades the
    // boundary HOLDING, not the eventual break.
    assert.ok(Math.abs((demand.low + demand.high) / 2 - 99.9) < 0.01);
    assert.ok(Math.abs((supply.low + supply.high) / 2 - 110.2) < 0.01);
    assert.equal(demand.patternBoundary.boundaryType, "range_edge");
    assert.equal(demand.patternBoundary.stage, "forming");
  });

  it("offers nothing from a completed pattern — its boundary already broke", () => {
    const completed = { ...formingRectangle(), status: "completed" as const };
    assert.deepEqual(patternBoundaryZones(snapshot([completed]), 1), []);
  });

  it("offers nothing from an invalidated pattern", () => {
    const invalidated = { ...formingRectangle(), status: "invalidated" as const };
    assert.deepEqual(patternBoundaryZones(snapshot([invalidated]), 1), []);
  });

  it("carries the neckline when the detector reports one", () => {
    const withNeckline: PatternInstance = {
      ...formingRectangle(),
      patternType: "triple_top",
      neckline: {
        from: { time: 1, price: 103.5 },
        to: { time: 2, price: 103.5 },
      },
      breakDirection: "down",
    };
    const zones = patternBoundaryZones(snapshot([withNeckline]), 1);
    const neckline = zones.find((z) => z.patternBoundary.boundaryType === "neckline");
    assert.ok(neckline, "the decisive level of the pattern must be on the menu");
    assert.equal(neckline.type, "demand");
  });

  it("returns nothing without a usable ATR", () => {
    assert.deepEqual(patternBoundaryZones(snapshot([formingRectangle()]), null), []);
    assert.deepEqual(patternBoundaryZones(snapshot([formingRectangle()]), 0), []);
  });

  it("marks its zones so the candidate carries the anticipatory caveat", () => {
    const zones = patternBoundaryZones(snapshot([formingRectangle()]), 1);
    for (const zone of zones) {
      assert.ok(isPatternBoundaryZone(zone));
      assert.equal(zone.patternBoundary.patternType, "rectangle");
    }
    // And a plain zone is not falsely claimed.
    assert.equal(
      isPatternBoundaryZone({ type: "demand", low: 1, high: 2, time: 3 }),
      false,
    );
  });
});

describe("the boundary reaches the candidate engine, not just the prompt", () => {
  it("is consumed by buildTradeCandidates through the zones input", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const risk = readFileSync(
      resolve(process.cwd(), "src/lib/agent/agents/riskAgent.ts"),
      "utf8",
    );
    // The wiring the plan demands: boundary zones flow into the SAME zones
    // array buildTradeCandidates scores — same geometry rules, same POI menu.
    assert.ok(
      /patternBoundaryZones\(input\.geometry, market\.atr\)/.test(risk),
      "the risk agent must feed pattern boundaries into the candidate zones",
    );
    const orchestrator = readFileSync(
      resolve(process.cwd(), "src/lib/agent/orchestrator.ts"),
      "utf8",
    );
    // Geometry must be computed BEFORE the risk agent, or the zones are empty.
    const geometryAt = orchestrator.indexOf("const geometry = detectChartGeometry");
    const riskAt = orchestrator.indexOf("runRiskAgent(trackedCtx");
    assert.ok(geometryAt >= 0 && riskAt >= 0);
    assert.ok(
      geometryAt < riskAt,
      "geometry is computed after the candidate engine — the boundaries never arrive",
    );
  });
});
