import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeActivityMessage } from "@/lib/agent/activity";
import {
  clearAgentDrawings,
  keepExplicitUserDrawings,
  sanitizeAgentDrawings,
  drawingOwner,
} from "@/lib/agent/drawings/drawingOwnership";
import type { ChartDrawing } from "@/lib/chartDrawings";

describe("sanitizeActivityMessage", () => {
  it("strips chain-of-thought phrasing (EN + AR)", () => {
    assert.ok(!sanitizeActivityMessage("chain of thought: buy now").includes("chain of thought"));
    assert.ok(!sanitizeActivityMessage("سلسلة التفكير: بيع").includes("سلسلة التفكير"));
    assert.ok(!sanitizeActivityMessage("scratchpad note").toLowerCase().includes("scratchpad"));
  });

  it("caps message length", () => {
    const long = "x".repeat(500);
    assert.ok(sanitizeActivityMessage(long).length <= 240);
  });
});

describe("drawingOwnership", () => {
  const userDrawing: ChartDrawing = {
    type: "trend_line",
    confidence: 100,
    points: [
      { time: 1, price: 10 },
      { time: 2, price: 12 },
    ],
    meta: { owner: "user" },
  };

  it("clearAgentDrawings keeps user drawings, drops agent drawings", () => {
    const agent = sanitizeAgentDrawings(
      [{ type: "price_line", confidence: 60, points: [{ time: 3, price: 11 }] }],
      { analysisId: "a1" },
    );
    const mixed = [userDrawing, ...agent];
    const cleared = clearAgentDrawings(mixed);
    assert.equal(cleared.length, 1);
    assert.equal(drawingOwner(cleared[0]!), "user");
  });

  it("clearAgentDrawings with analysisId only clears that analysis", () => {
    const a1 = sanitizeAgentDrawings(
      [{ type: "price_line", confidence: 60, points: [{ time: 3, price: 11 }] }],
      { analysisId: "a1" },
    );
    const a2 = sanitizeAgentDrawings(
      [{ type: "price_line", confidence: 60, points: [{ time: 4, price: 13 }] }],
      { analysisId: "a2" },
    );
    const cleared = clearAgentDrawings([...a1, ...a2], "a1");
    assert.equal(cleared.length, 1);
  });

  it("keepExplicitUserDrawings drops agent دخول/وقف/هدف lines that persist-clear must not restore", () => {
    const entry = sanitizeAgentDrawings(
      [{ type: "price_line", confidence: 70, label: "دخول", points: [{ price: 100 }] }],
      { analysisId: "a1" },
    )[0]!;
    const stop = sanitizeAgentDrawings(
      [{ type: "price_line", confidence: 70, label: "وقف خسارة", points: [{ price: 99 }] }],
      { analysisId: "a1" },
    )[0]!;
    const target = sanitizeAgentDrawings(
      [{ type: "price_line", confidence: 70, label: "هدف 1", points: [{ price: 102 }] }],
      { analysisId: "a1" },
    )[0]!;
    const bos = sanitizeAgentDrawings(
      [{ type: "price_line", confidence: 70, label: "هابط BOS", points: [{ price: 101 }] }],
      { analysisId: "a1" },
    )[0]!;
    assert.deepEqual(
      keepExplicitUserDrawings([userDrawing, entry, stop, target, bos]),
      [userDrawing],
    );
  });

  it("keepExplicitUserDrawings drops unstamped leftovers that drawingOwner treats as user", () => {
    const leftover: ChartDrawing = {
      type: "price_line",
      confidence: 80,
      points: [{ time: 1, price: 11 }],
    };
    assert.equal(drawingOwner(leftover), "user");
    assert.deepEqual(keepExplicitUserDrawings([userDrawing, leftover]), [userDrawing]);
  });

  it("sanitizeAgentDrawings drops invalid prices and stamps ownership", () => {
    const out = sanitizeAgentDrawings(
      [
        { type: "price_line", confidence: 60, points: [{ time: 1, price: -5 }] },
        { type: "price_line", confidence: 60, points: [{ time: 2, price: 10 }] },
      ],
      { analysisId: "a1" },
    );
    assert.equal(out.length, 1);
    assert.equal(drawingOwner(out[0]!), "agent");
    assert.equal((out[0]!.meta as { analysisId?: string }).analysisId, "a1");
  });

  it("sanitizeAgentDrawings enforces price bounds", () => {
    const out = sanitizeAgentDrawings(
      [{ type: "price_line", confidence: 60, points: [{ time: 1, price: 999999 }] }],
      { analysisId: "a1", priceBounds: { min: 1, max: 100 } },
    );
    assert.equal(out.length, 0);
  });
});
