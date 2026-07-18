import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replayDecision } from "@/lib/agent/evaluation/replayDecision";
import { scoreDecisionOutcome } from "@/lib/agent/evaluation/scoreDecisionOutcome";
import { trendingCandles } from "@/lib/agent/evaluation/fixtures/candleFixtures";
import type { AgentCandle } from "@/lib/agent/marketContext/detectors";

const BAR = 60_000;

function candle(i: number, o: number, h: number, l: number, c: number): AgentCandle {
  return { time: i * BAR, open: o, high: h, low: l, close: c };
}

describe("replayDecision", () => {
  it("freezes time at the decision candle (no lookahead)", () => {
    const candles = trendingCandles({
      count: 100,
      start: 100,
      stepUp: 0.5,
      stepDown: 0.3,
      direction: "up",
    });
    const replay = replayDecision({ candles, decisionIndex: 49 });
    assert.equal(replay.decisionTime, candles[49]!.time);
    assert.equal(replay.futureCandles.length, 50);
    assert.equal(replay.futureCandles[0]!.time, candles[50]!.time);
    assert.ok(typeof replay.decisionPrice === "number");
    assert.ok(replay.zoneCount >= 0);
    assert.ok(!("action" in replay));
    assert.ok(!("candidate" in replay));
  });
});

describe("scoreDecisionOutcome", () => {
  const buy = { action: "buy" as const, entry: 100, stop_loss: 99, targets: [102] };

  it("scores a TP hit as a win with the planned RR", () => {
    const futures = [
      candle(0, 100.5, 100.6, 99.9, 100.2), // touches entry
      candle(1, 100.2, 101.0, 100.0, 100.9),
      candle(2, 100.9, 102.3, 100.8, 102.1), // hits TP
    ];
    const out = scoreDecisionOutcome({ ...buy, futureCandles: futures });
    assert.equal(out.entryTriggered, true);
    assert.equal(out.result, "win");
    assert.equal(out.rrAchieved, 2);
    assert.equal(out.candlesToOutcome, 3);
  });

  it("scores an SL hit as a loss (rr −1)", () => {
    const futures = [
      candle(0, 100.5, 100.6, 99.9, 100.2), // touches entry
      candle(1, 100.2, 100.4, 98.8, 98.9), // hits SL
    ];
    const out = scoreDecisionOutcome({ ...buy, futureCandles: futures });
    assert.equal(out.result, "loss");
    assert.equal(out.rrAchieved, -1);
  });

  it("scores no-entry when price never returns to the entry zone", () => {
    const futures = [
      candle(0, 101.5, 102.0, 101.2, 101.8),
      candle(1, 101.8, 102.5, 101.5, 102.4),
    ];
    const out = scoreDecisionOutcome({ ...buy, futureCandles: futures });
    assert.equal(out.entryTriggered, false);
    assert.equal(out.result, "no_entry");
  });

  it("scores timeout when neither TP nor SL is hit within the horizon", () => {
    const futures = Array.from({ length: 20 }, (_, i) =>
      candle(i, 100.1, 100.6, 99.8, 100.3),
    );
    const out = scoreDecisionOutcome({ ...buy, futureCandles: futures, horizon: 20 });
    assert.equal(out.entryTriggered, true);
    assert.equal(out.result, "timeout");
  });

  it("WAIT decisions are not applicable", () => {
    const out = scoreDecisionOutcome({ action: "wait", futureCandles: [] });
    assert.equal(out.result, "not_applicable");
  });
});
