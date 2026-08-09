import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sanitizeSerializedDrawing,
  sanitizeSerializedDrawings,
  drawingPriceLevels,
} from "@/lib/chart/drawings/serializeUserDrawings";
import {
  isUserDrawing,
  ownerOf,
  userDrawings,
  findDrawingById,
} from "@/lib/chart/drawings/drawingOwnership";
import { DRAWING_LIMITS, type SerializedChartDrawing } from "@/lib/chart/drawings/types";

function drawing(over: Partial<SerializedChartDrawing> = {}): SerializedChartDrawing {
  return {
    id: "d1",
    owner: "user",
    type: "hline",
    symbol: "XAUUSD",
    interval: "15m",
    points: [{ price: 2400 }],
    source: "tradingview",
    ...over,
  };
}

describe("sanitizeSerializedDrawing", () => {
  it("drops a drawing with no id or type", () => {
    assert.equal(sanitizeSerializedDrawing({ type: "hline", points: [{ price: 1 }] }), null);
    assert.equal(sanitizeSerializedDrawing({ id: "x", points: [{ price: 1 }] }), null);
  });

  it("drops a drawing with no usable geometry", () => {
    assert.equal(sanitizeSerializedDrawing({ id: "x", type: "hline", points: [] }), null);
  });

  it("drops malformed points (NaN / non-positive price)", () => {
    const clean = sanitizeSerializedDrawing({
      id: "x",
      type: "hline",
      points: [{ price: Number.NaN }, { price: -5 }, { price: 2400 }, {}],
    });
    assert.ok(clean);
    assert.equal(clean!.points.length, 1);
    assert.equal(clean!.points[0]!.price, 2400);
  });

  it("caps points at the max and label length", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ price: 100 + i }));
    const clean = sanitizeSerializedDrawing({
      id: "x",
      type: "trend_line",
      points: many,
      label: "a".repeat(500),
    });
    assert.ok(clean);
    assert.equal(clean!.points.length, DRAWING_LIMITS.maxPoints);
    assert.equal(clean!.label!.length, DRAWING_LIMITS.maxLabel);
  });

  it("defaults owner to user and source to tradingview", () => {
    const clean = sanitizeSerializedDrawing({ id: "x", type: "hline", points: [{ price: 1 }] });
    assert.equal(clean!.owner, "user");
    assert.equal(clean!.source, "tradingview");
  });

  it("preserves agent/recommendation owner when provided", () => {
    const clean = sanitizeSerializedDrawing({
      id: "x",
      type: "hline",
      owner: "agent",
      points: [{ price: 1 }],
    });
    assert.equal(clean!.owner, "agent");
  });
});

describe("sanitizeSerializedDrawings", () => {
  it("caps the list at the max drawings limit", () => {
    const raw = Array.from({ length: 80 }, (_, i) => ({
      id: `d${i}`,
      type: "hline",
      points: [{ price: 100 + i }],
    }));
    assert.equal(sanitizeSerializedDrawings(raw).length, DRAWING_LIMITS.maxDrawings);
  });

  it("returns [] for non-array input", () => {
    assert.deepEqual(sanitizeSerializedDrawings("nope"), []);
  });
});

describe("drawingPriceLevels", () => {
  it("merges point prices and explicit levels", () => {
    const d = drawing({ points: [{ price: 2400 }, { price: 2410 }], priceLevels: [2405] });
    assert.deepEqual(drawingPriceLevels(d).sort(), [2400, 2405, 2410]);
  });
});

describe("ownership", () => {
  it("filters user drawings only", () => {
    const list = [
      drawing({ id: "u", owner: "user" }),
      drawing({ id: "a", owner: "agent" }),
      drawing({ id: "r", owner: "recommendation" }),
    ];
    assert.deepEqual(userDrawings(list).map((d) => d.id), ["u"]);
    assert.equal(isUserDrawing(list[0]!), true);
    assert.equal(isUserDrawing(list[1]!), false);
    assert.equal(ownerOf(list[2]!), "recommendation");
  });

  it("findDrawingById honors a required owner", () => {
    const list = [drawing({ id: "a", owner: "agent" })];
    assert.equal(findDrawingById(list, "a", "user"), null);
    assert.ok(findDrawingById(list, "a", "agent"));
    assert.equal(findDrawingById(list, "missing"), null);
  });
});
