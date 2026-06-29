import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { tradePlanToDrawings } from "@/lib/chart/tradePlanToDrawings";
import { mapChartDrawingsToMt5Objects } from "@/lib/chart/mt5DrawingMapper";
import { buildTradingCards } from "@/lib/cards/buildTradingCards";

test("tradePlanToDrawings returns no execution drawings for wait", () => {
  assert.deepEqual(
    tradePlanToDrawings({
      symbol: "XAUUSD",
      market: "forex",
      timeframe: "1h",
      side: "wait",
      entry: 2300,
      stopLoss: 2290,
      takeProfits: [2320],
    }),
    [],
  );
});

test("tradePlanToDrawings creates anchored RR, entry, SL, TP and scenario drawings", () => {
  const out = tradePlanToDrawings({
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "1h",
    side: "buy",
    entry: 2300,
    stopLoss: 2290,
    takeProfits: [2320, 2330],
    startTime: 1_700_000_000_000,
  });
  assert.ok(out.some((d) => d.type === "risk_reward_box"));
  assert.ok(out.every((d) => d.anchorMode === "time_price"));
  assert.ok(out.flatMap((d) => d.points).every((p) => p.time && p.price > 0));
  assert.equal(out.filter((d) => d.semanticRole === "take_profit").length, 2);
});

test("mapChartDrawingsToMt5Objects maps risk reward and polylines into EA objects", () => {
  const drawings: ChartDrawing[] = [
    {
      type: "risk_reward_box",
      confidence: 90,
      points: [
        { time: 1_700_000_000_000, price: 2300 },
        { time: 1_700_003_600_000, price: 2290 },
        { time: 1_700_003_600_000, price: 2320 },
      ],
      meta: { entry: 2300, stopLoss: 2290, takeProfit: 2320 },
    },
    {
      type: "polyline_pattern",
      confidence: 80,
      label: "نموذج W",
      points: [
        { time: 1_700_000_000_000, price: 2300 },
        { time: 1_700_001_800_000, price: 2310 },
        { time: 1_700_003_600_000, price: 2301 },
      ],
    },
  ];
  const out = mapChartDrawingsToMt5Objects(drawings, { symbol: "XAUUSD", timeframe: "1h" });
  assert.ok(out.some((o) => o.object_type === "OBJ_RECTANGLE"));
  assert.ok(out.filter((o) => o.object_type === "OBJ_TREND").length >= 2);
  assert.ok(out.every((o) => o.source === "aichart"));
});

test("buildTradingCards prefers trade plan and risk reward for actionable recs", () => {
  const cards = buildTradingCards({
    summary: "خطة شراء مكتملة",
    recommendations: [
      {
        symbol: "XAUUSD",
        action: "buy",
        timeframe: "1h",
        entry: 2300,
        stop_loss: 2290,
        take_profit: 2320,
        confidence: 82,
      },
    ],
  });
  assert.deepEqual(cards.map((c) => c.kind), ["trade_plan", "risk_reward"]);
});
