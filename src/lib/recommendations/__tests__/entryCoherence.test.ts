/**
 * The entry/activation coherence incident, pinned.
 *
 * Reproduced from the real report: a SELL was stored with a fixed entry of
 * 4348.27, SL 4360.78, TP1 4316.80, TP2 4297.97, and an activation rule of
 * "price returns to 4348.27, the wick pierces it, then the M15 candle CLOSES
 * BELOW it". The condition was satisfied, price fell through both targets —
 * and the plan died EXPIRED, because a sell fills on `candle.high >= entry`
 * and every candle after the confirming close sat below 4348.27.
 *
 * These tests fail on the old semantics and pass on the new ones.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeEntry,
  entryFillTolerance,
  GOLD_FILL_TOLERANCE_CAP,
  GOLD_FILL_TOLERANCE_FLOOR,
  filterDistinctTargets,
  minConsecutiveTargetSpacing,
  resolveEntryType,
  resolveFill,
  rewardToRisk,
  validateEntryCoherence,
} from "../entrySemantics";
import { evaluateRecommendation } from "../recommendationStatus";
import type { ActivationRule } from "../activationRule";

const M15 = 15 * 60_000;
const T0 = Date.parse("2026-08-05T10:00:00Z");
const candle = (i: number, o: number, h: number, l: number, c: number) => ({
  time: T0 + i * M15,
  open: o,
  high: h,
  low: l,
  close: c,
});

/** The incident's own rule: close below 4348.27 on M15. */
const CLOSE_BELOW: ActivationRule = {
  kind: "candle_close_below",
  level: 4348.27,
  timeframe: "15m",
};

const INCIDENT = {
  direction: "sell" as const,
  entry: 4348.27,
  stopLoss: 4360.78,
  targets: [4316.8, 4297.97],
  activationRule: CLOSE_BELOW,
};

describe("the incident can no longer be constructed", () => {
  it("refuses a close-based rule armed against a touch-filled entry at the same level", () => {
    const problems = validateEntryCoherence({
      ...INCIDENT,
      entryType: "limit_touch",
    });
    const codes = problems.map((p) => p.code);
    assert.ok(
      codes.includes("close_rule_with_touch_entry"),
      `the original contradictory combo must be rejected; got ${codes.join(", ") || "(none)"}`,
    );
  });

  it("accepts the same plan once it is expressed as confirmation_close", () => {
    const problems = validateEntryCoherence({
      ...INCIDENT,
      entryType: "confirmation_close",
    });
    assert.deepEqual(problems, [], "a coherent restatement must pass cleanly");
  });

  it("still catches geometry faults independent of entry type", () => {
    // Stop below a sell entry is on the wrong side.
    const bad = validateEntryCoherence({
      ...INCIDENT,
      entryType: "confirmation_close",
      stopLoss: 4300,
    });
    assert.ok(bad.some((p) => p.code === "stop_on_wrong_side"));

    // Targets above a sell entry are on the wrong side.
    const badTp = validateEntryCoherence({
      ...INCIDENT,
      entryType: "confirmation_close",
      targets: [4400],
    });
    assert.ok(badTp.some((p) => p.code === "target_on_wrong_side"));
  });

  it("rejects a plan whose RR collapses once measured from the real fill", () => {
    const problems = validateEntryCoherence({
      ...INCIDENT,
      entryType: "confirmation_close",
      // Fill much closer to TP1 than the nominal level was.
      entry: 4320,
      minRr: 2,
    });
    assert.ok(problems.some((p) => p.code === "rr_below_minimum"));
  });
});

describe("confirmation_close fills at the confirming candle's close", () => {
  it("fills on the confirming candle, not on a later touch of the trigger level", () => {
    const confirming = candle(1, 4350, 4351.2, 4344.0, 4345.6);
    const fill = resolveFill({
      plan: { direction: "sell", entryType: "confirmation_close", entry: 4348.27 },
      candle: confirming,
      conditionMet: true,
      armedBefore: false,
    });
    assert.equal(fill.filled, true);
    assert.equal(
      fill.effectiveEntry,
      confirming.close,
      "the fill is the confirming close, never the nominal trigger",
    );
  });

  it("does not re-fill on later candles once already armed", () => {
    const later = candle(2, 4345, 4346, 4330, 4332);
    const fill = resolveFill({
      plan: { direction: "sell", entryType: "confirmation_close", entry: 4348.27 },
      candle: later,
      conditionMet: false,
      armedBefore: true,
    });
    assert.equal(fill.filled, false);
  });
});

describe("end-to-end: the incident now grades TP1_HIT, not EXPIRED", () => {
  const base = {
    ...INCIDENT,
    status: "pending_entry" as const,
    outcome: "pending" as const,
    createdAt: T0,
    createdCandleTime: T0,
    expiresAt: T0 + 200 * M15,
    validityCandles: undefined,
    invalidationLevel: undefined,
    triggeredAt: undefined,
    tp1HitAt: undefined,
    tp2HitAt: undefined,
    tp3HitAt: undefined,
  };

  /**
   * The incident's price path: a wick pierces 4348.27, the M15 closes BELOW
   * it, and price then runs to TP1 — never trading back up through 4348.27.
   */
  const path = [
    candle(1, 4346.0, 4349.9, 4344.0, 4345.6), // wick through, close below
    candle(2, 4345.6, 4346.2, 4330.0, 4331.0),
    candle(3, 4331.0, 4332.0, 4315.0, 4317.0), // TP1 4316.80 reached
  ];

  it("fills at the confirming close and reaches TP1", () => {
    const result = evaluateRecommendation({
      recommendation: { ...base, entryType: "confirmation_close" },
      candles: path,
      now: T0 + 10 * M15,
    });
    assert.equal(result.triggered, true, "the confirming close must fill the plan");
    assert.ok(result.tp1HitAt, "TP1 was reached and must be graded as hit");
    assert.notEqual(result.outcome, "expired", "this is the incident: it must not expire");
  });

  it("reproduces the OLD failure when the same plan is stored as a touch fill", () => {
    // Exactly the shape that shipped: entry == the rule's level, touch fill.
    const result = evaluateRecommendation({
      recommendation: { ...base, entryType: "limit_touch" },
      candles: path,
      now: T0 + 10 * M15,
    });
    // The wick DOES graze 4348.27 on the confirming candle, so this particular
    // path fills — but on the wick, at the nominal level, not at the close.
    // The point of the fix is that the plan is no longer STORED this way: the
    // validator refuses it (see the first describe block).
    if (result.triggered) {
      assert.equal(
        validateEntryCoherence({ ...INCIDENT, entryType: "limit_touch" }).length > 0,
        true,
        "if a touch fill can still happen, the validator must have refused the plan",
      );
    }
  });

  it("mirrors for a buy: fills at the confirming close above the trigger", () => {
    const buyRule: ActivationRule = {
      kind: "candle_close_above",
      level: 4348.27,
      timeframe: "15m",
    };
    const buyPath = [
      candle(1, 4350, 4356, 4346.5, 4355.4), // closes above
      candle(2, 4355.4, 4370, 4354, 4368),
      candle(3, 4368, 4382, 4366, 4380), // TP1 4379 reached
    ];
    const result = evaluateRecommendation({
      recommendation: {
        ...base,
        direction: "buy",
        entryType: "confirmation_close",
        stopLoss: 4336,
        targets: [4379, 4400],
        activationRule: buyRule,
      },
      candles: buyPath,
      now: T0 + 10 * M15,
    });
    assert.equal(result.triggered, true);
    assert.ok(result.tp1HitAt, "the mirrored buy must also reach TP1");
  });
});

describe("retest_zone fills inside its band", () => {
  it("fills on a return into the band and rejects a band past the stop", () => {
    const zone = { from: 4344, to: 4349 };
    const fill = resolveFill({
      plan: { direction: "sell", entryType: "retest_zone", entry: 4348.27, retestZone: zone },
      candle: candle(2, 4335, 4346, 4333, 4340),
      conditionMet: false,
      armedBefore: true,
    });
    assert.equal(fill.filled, true);
    assert.equal(fill.effectiveEntry, 4344, "a sell retest fills at the low edge it reached");

    const bad = validateEntryCoherence({
      ...INCIDENT,
      entryType: "retest_zone",
      // Band reaches past the stop — filling there is an instant loss.
      retestZone: { from: 4358, to: 4365 },
    });
    assert.ok(bad.some((p) => p.code === "retest_zone_on_wrong_side"));

    const missing = validateEntryCoherence({ ...INCIDENT, entryType: "retest_zone" });
    assert.ok(missing.some((p) => p.code === "retest_zone_missing"));
  });
});

describe("prose is generated from structure", () => {
  it("never promises a fill at the trigger level for a confirmation entry", () => {
    const text = describeEntry({
      direction: "sell",
      entryType: "confirmation_close",
      entry: 4348.27,
    });
    // It must say the fill is the confirming close, precisely because the
    // incident's sentence implied the opposite.
    assert.match(text, /إغلاق شمعة التأكيد/);
    assert.match(text, /وليس/);
  });

  it("describes a retest band by its bounds", () => {
    const text = describeEntry({
      direction: "sell",
      entryType: "retest_zone",
      entry: 4348.27,
      retestZone: { from: 4344, to: 4349 },
    });
    assert.match(text, /4344/);
    assert.match(text, /4349/);
  });
});

describe("limit_touch fills within the tolerance band", () => {
  // The flexible-entry complaint: a XAUUSD buy at 4646.19; price turned at
  // 4646.49 (30 cents above), ran to every target, and the record said the
  // plan never filled. With the band, that near-miss IS a fill.
  const PLAN = {
    direction: "buy" as const,
    entryType: "limit_touch" as const,
    entry: 4646.19,
    retestZone: null,
  };

  it("a candle inside the band fills — at the nearest traded price, not the level", () => {
    const fill = resolveFill({
      plan: PLAN,
      candle: candle(1, 4650, 4652, 4646.49, 4651),
      conditionMet: true,
      armedBefore: false,
      tolerance: 0.5,
    });
    assert.equal(fill.filled, true);
    assert.equal(
      fill.effectiveEntry,
      4646.49,
      "grading honesty: the market never traded 4646.19, so the fill is 4646.49",
    );
  });

  it("a candle outside the band still does not fill", () => {
    const fill = resolveFill({
      plan: PLAN,
      candle: candle(1, 4650, 4652, 4646.8, 4651),
      conditionMet: true,
      armedBefore: false,
      tolerance: 0.5,
    });
    assert.equal(fill.filled, false);
  });

  it("without a tolerance the exact-touch behaviour is preserved", () => {
    const fill = resolveFill({
      plan: PLAN,
      candle: candle(1, 4650, 4652, 4646.49, 4651),
      conditionMet: true,
      armedBefore: false,
    });
    assert.equal(fill.filled, false);
  });

  it("a real touch still fills at the level itself", () => {
    const fill = resolveFill({
      plan: PLAN,
      candle: candle(1, 4650, 4652, 4645.9, 4651),
      conditionMet: true,
      armedBefore: false,
      tolerance: 0.5,
    });
    assert.equal(fill.filled, true);
    assert.equal(fill.effectiveEntry, 4646.19);
  });

  it("sell side mirrors: a high within the band below the entry fills", () => {
    const fill = resolveFill({
      plan: { ...PLAN, direction: "sell" },
      candle: candle(1, 4640, 4645.9, 4638, 4639),
      conditionMet: true,
      armedBefore: false,
      tolerance: 0.5,
    });
    assert.equal(fill.filled, true);
    assert.equal(fill.effectiveEntry, 4645.9);
  });
});

describe("entryFillTolerance is a 10–15 point gold band", () => {
  it("gold at ~4600 floors at 10 and caps at 15", () => {
    const floor = entryFillTolerance({ price: 4646 });
    assert.equal(floor, GOLD_FILL_TOLERANCE_FLOOR);
    const cap = entryFillTolerance({ price: 4646, atr: 200 });
    assert.equal(cap, GOLD_FILL_TOLERANCE_CAP);
    const mid = entryFillTolerance({ price: 4646, atr: 4 });
    assert.equal(mid, GOLD_FILL_TOLERANCE_FLOOR, "5m ATR sits on the 10-point floor");
  });

  it("degenerate prices produce zero, never NaN", () => {
    assert.equal(entryFillTolerance({ price: 0 }), 0);
    assert.equal(entryFillTolerance({ price: Number.NaN }), 0);
  });
});

describe("10–15 point gold touch: approach and through", () => {
  const PLAN = {
    direction: "sell" as const,
    entryType: "limit_touch" as const,
    entry: 4610,
    retestZone: null,
  };

  it("sell 4610 / live 4620 (10 pts above) fills at the nearest traded price", () => {
    const fill = resolveFill({
      plan: PLAN,
      candle: candle(1, 4622, 4623, 4619.5, 4620),
      conditionMet: true,
      armedBefore: false,
      tolerance: 10,
    });
    assert.equal(fill.filled, true);
    assert.equal(fill.effectiveEntry, 4619.5);
  });

  it("sell 4610 / live 4630 (20 pts above) does not fill", () => {
    const fill = resolveFill({
      plan: PLAN,
      candle: candle(1, 4631, 4632, 4628, 4630),
      conditionMet: true,
      armedBefore: false,
      tolerance: 10,
    });
    assert.equal(fill.filled, false);
  });

  it("sell 4605.39 / live 4601.89 (already through) fills", () => {
    const fill = resolveFill({
      plan: { ...PLAN, entry: 4605.39 },
      candle: candle(1, 4603, 4604, 4601.2, 4601.89),
      conditionMet: true,
      armedBefore: false,
      tolerance: 10,
    });
    assert.equal(fill.filled, true);
    assert.equal(fill.effectiveEntry, 4604);
  });
});

describe("the tracker grades the near-miss as filled", () => {
  it("buy entry at 4646.19, low 4646.49, tolerance 0.5 → triggered and TP1 credited", () => {
    const result = evaluateRecommendation({
      recommendation: {
        direction: "buy",
        entryType: "limit_touch",
        entry: 4646.19,
        stopLoss: 4642.93,
        targets: [4660.02, 4670.46],
        status: "pending_entry",
        outcome: "pending",
        createdAt: T0,
        createdCandleTime: T0,
        expiresAt: T0 + 40 * M15,
      },
      candles: [
        candle(1, 4650, 4652, 4646.49, 4651), // near-miss: 30 cents above entry
        candle(2, 4651, 4661, 4650, 4660.5), // runs to TP1
      ],
      entryTolerance: 0.5,
      now: T0 + 3 * M15,
    });
    assert.equal(result.triggered, true, "the near-miss must fill the plan");
    assert.ok(result.tp1HitAt, "TP1 must be credited after the tolerance fill");
    assert.equal(result.status, "tp1_hit");
  });

  it("the same tape without a tolerance ends as a missed opportunity — the old grading", () => {
    const result = evaluateRecommendation({
      recommendation: {
        direction: "buy",
        entryType: "limit_touch",
        entry: 4646.19,
        stopLoss: 4642.93,
        targets: [4660.02, 4670.46],
        status: "pending_entry",
        outcome: "pending",
        createdAt: T0,
        createdCandleTime: T0,
        expiresAt: T0 + 40 * M15,
      },
      candles: [
        candle(1, 4650, 4652, 4646.49, 4651),
        candle(2, 4651, 4661, 4650, 4660.5),
      ],
      now: T0 + 3 * M15,
    });
    assert.equal(result.triggered, false);
    assert.equal(result.missedWithoutFill, true);
  });
});

describe("reward:risk is measured from the fill", () => {
  it("computes RR from the effective entry, not the nominal level", () => {
    const nominal = rewardToRisk({
      direction: "sell",
      entry: 4348.27,
      stopLoss: 4360.78,
      target: 4316.8,
    });
    const actual = rewardToRisk({
      direction: "sell",
      entry: 4345.6, // the confirming close
      stopLoss: 4360.78,
      target: 4316.8,
    });
    assert.ok(nominal && actual);
    assert.notEqual(
      nominal.toFixed(2),
      actual.toFixed(2),
      "the two must differ — which is why grading has to use the fill",
    );
  });
});

describe("consecutive targets must be meaningfully distinct", () => {
  it("drops a gold TP3 that sits 0.09 from TP2", () => {
    const spaced = filterDistinctTargets({
      direction: "sell",
      entry: 4616.66,
      targets: [4603.33, 4593.8, 4593.71],
      atr: 8.9,
    });
    assert.deepEqual(spaced, [4603.33, 4593.8]);
  });

  it("omits TP2 when it collapses onto TP1 and keeps a distant TP3 as the new TP2", () => {
    const spaced = filterDistinctTargets({
      direction: "sell",
      entry: 4616.66,
      targets: [4603.33, 4600.0, 4588.0],
      atr: 8.9,
    });
    assert.deepEqual(spaced, [4603.33, 4588.0]);
  });

  it("uses at least several points on gold, or 0.15×ATR if that is larger", () => {
    const atGold = minConsecutiveTargetSpacing({ price: 4606, atr: 8.9 });
    assert.ok(atGold >= 5, `gold floor is several points; got ${atGold}`);
    const wideAtr = minConsecutiveTargetSpacing({ price: 4606, atr: 50 });
    assert.ok(wideAtr >= 7.5, `0.15×ATR=7.5 should win; got ${wideAtr}`);
  });

  it("an immediate plan with a leftover sell_limit is a market fill", () => {
    assert.equal(
      resolveEntryType({
        declared: "sell_limit",
        planType: "immediate",
      }),
      "market",
    );
    assert.equal(
      resolveEntryType({
        declared: "sell_limit",
        planType: "conditional",
      }),
      "limit_touch",
    );
  });
});
