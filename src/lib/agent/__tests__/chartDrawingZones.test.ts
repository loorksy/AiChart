import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chartDrawingZones } from "@/lib/agent/trading/chartDrawingZones";
import type { ChartDrawing } from "@/lib/chartDrawings";

describe("chartDrawingZones", () => {
  it("turns user support/resistance drawings into candidate zones", () => {
    const drawings: ChartDrawing[] = [
      {
        type: "price_line",
        confidence: 80,
        semanticRole: "support",
        points: [{ price: 1.143 }],
      },
      {
        type: "price_line",
        confidence: 80,
        semanticRole: "resistance",
        points: [{ price: 1.146 }],
      },
    ];
    const zones = chartDrawingZones({
      drawings,
      currentPrice: 1.144,
      atr: 0.001,
      lastCandleTime: 1,
    });
    assert.equal(zones.length, 2);
    assert.equal(zones[0]!.type, "demand");
    assert.equal(zones[1]!.type, "supply");
  });

  it("ignores agent-owned drawings to avoid self-reinforcing old output", () => {
    const zones = chartDrawingZones({
      drawings: [
        {
          type: "price_line",
          confidence: 80,
          semanticRole: "support",
          points: [{ price: 1.143 }],
          meta: { owner: "agent" },
        },
      ],
      currentPrice: 1.144,
      atr: 0.001,
    });
    assert.equal(zones.length, 0);
  });
});
