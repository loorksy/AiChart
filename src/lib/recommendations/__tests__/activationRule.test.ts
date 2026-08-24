import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createActivationEvaluator,
  normalizeActivationRule,
  describeActivationRule,
  evaluateActivationRule,
  explainActivationRuleIncoherence,
  parseActivationRule,
  serializeActivationRule,
  type ActivationRule,
} from "@/lib/recommendations/activationRule";
import type { TrackerCandle } from "@/lib/recommendations/recommendationStatus";

/**
 * The finding these pin: a conditional plan used to fill on a bare price touch
 * regardless of what its stored condition demanded. Every negative case below
 * fails on the old touch-based logic, because that logic could not tell a wick
 * from a close, a break from a retest, or a rejection from either.
 */

function candle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
): TrackerCandle {
  return { time, open, high, low, close };
}

/** A wick that pierces 100 but closes back below it. */
const WICK_THROUGH_100 = candle(1, 98, 101.5, 97.5, 99);
/** A body that closes cleanly above 100. */
const CLOSE_ABOVE_100 = candle(2, 99, 101.8, 98.8, 101.2);

describe("price_touch", () => {
  const rule: ActivationRule = {
    kind: "price_touch",
    level: 100,
    direction: "above",
    timeframe: "1h",
  };

  it("activates on a wick that only touches the level", () => {
    assert.equal(evaluateActivationRule(rule, [WICK_THROUGH_100]).activated, true);
  });

  it("does not activate while price stays away from the level", () => {
    assert.equal(
      evaluateActivationRule(rule, [candle(1, 95, 97, 94, 96)]).activated,
      false,
    );
  });
});

describe("candle_close_above", () => {
  const rule: ActivationRule = {
    kind: "candle_close_above",
    level: 100,
    timeframe: "1h",
  };

  it("is NOT satisfied by a wick above the level", () => {
    // The defect in one assertion: the same candle activates price_touch.
    assert.equal(evaluateActivationRule(rule, [WICK_THROUGH_100]).activated, false);
  });

  it("is satisfied by a close above the level", () => {
    const observation = evaluateActivationRule(rule, [CLOSE_ABOVE_100]);
    assert.equal(observation.activated, true);
    assert.equal(observation.evidence?.kind, "candle_close_above");
    assert.equal(observation.evidence?.at, 2);
  });

  it("requires the stated number of CONSECUTIVE closes", () => {
    const twoCloses: ActivationRule = {
      kind: "candle_close_above",
      level: 100,
      timeframe: "1h",
      closes: 2,
    };
    // One qualifying close, then a failure, then one more: never two in a row.
    const broken = [
      CLOSE_ABOVE_100,
      candle(3, 101, 101.4, 98, 99.2),
      candle(4, 99, 101.6, 98.9, 101.1),
    ];
    assert.equal(evaluateActivationRule(twoCloses, broken).activated, false);

    const consecutive = [CLOSE_ABOVE_100, candle(3, 101, 102, 100.5, 101.6)];
    assert.equal(evaluateActivationRule(twoCloses, consecutive).activated, true);
  });

  it("honours tolerance — a close barely above the level does not count", () => {
    const withTolerance: ActivationRule = {
      kind: "candle_close_above",
      level: 100,
      timeframe: "1h",
      tolerance: 0.5,
    };
    assert.equal(
      evaluateActivationRule(withTolerance, [candle(1, 99, 100.9, 98, 100.3)]).activated,
      false,
    );
    assert.equal(
      evaluateActivationRule(withTolerance, [candle(1, 99, 101.5, 98, 100.9)]).activated,
      true,
    );
  });
});

describe("candle_close_below", () => {
  const rule: ActivationRule = {
    kind: "candle_close_below",
    level: 100,
    timeframe: "1h",
  };

  it("is NOT satisfied by a wick below the level", () => {
    assert.equal(
      evaluateActivationRule(rule, [candle(1, 102, 103, 98.5, 101)]).activated,
      false,
    );
  });

  it("is satisfied by a close below the level", () => {
    assert.equal(
      evaluateActivationRule(rule, [candle(1, 102, 103, 98, 98.7)]).activated,
      true,
    );
  });
});

describe("breakout_confirmed", () => {
  const rule: ActivationRule = {
    kind: "breakout_confirmed",
    level: 100,
    direction: "above",
    timeframe: "1h",
    closes: 2,
  };

  it("is not satisfied by a single close beyond the level", () => {
    assert.equal(evaluateActivationRule(rule, [CLOSE_ABOVE_100]).activated, false);
  });

  it("is satisfied once the stated closes land consecutively", () => {
    assert.equal(
      evaluateActivationRule(rule, [CLOSE_ABOVE_100, candle(3, 101, 102.2, 100.4, 101.9)])
        .activated,
      true,
    );
  });
});

describe("retest_confirmed", () => {
  const rule: ActivationRule = {
    kind: "retest_confirmed",
    level: 100,
    direction: "above",
    retestZone: { low: 99.5, high: 100.5 },
    timeframe: "1h",
  };

  const BREAK = CLOSE_ABOVE_100;
  const RETURN_INTO_ZONE = candle(3, 101, 101.2, 99.8, 100.4);
  const CONFIRM = candle(4, 100.4, 102.5, 100.2, 102.1);

  it("is NOT satisfied by a breakout alone", () => {
    // The break happened and price ran away. A plan that asked to buy the retest
    // must not fill just because the level broke.
    assert.equal(
      evaluateActivationRule(rule, [BREAK, candle(3, 101, 104, 101, 103.8)]).activated,
      false,
    );
  });

  it("is NOT satisfied by a return to the zone with no confirming close", () => {
    assert.equal(evaluateActivationRule(rule, [BREAK, RETURN_INTO_ZONE]).activated, false);
  });

  it("is satisfied by break, return, then confirmation in that order", () => {
    const observation = evaluateActivationRule(rule, [BREAK, RETURN_INTO_ZONE, CONFIRM]);
    assert.equal(observation.activated, true);
    assert.equal(observation.evidence?.at, 4);
  });

  it("requires the order — a return before any break does not count", () => {
    assert.equal(
      evaluateActivationRule(rule, [RETURN_INTO_ZONE, CONFIRM]).activated,
      false,
    );
  });
});

describe("rejection_confirmed", () => {
  const rule: ActivationRule = {
    kind: "rejection_confirmed",
    level: 100,
    direction: "above",
    timeframe: "1h",
  };

  it("requires a wick THROUGH the level, not merely a close above it", () => {
    // Never traded below 100 — nothing was rejected.
    assert.equal(
      evaluateActivationRule(rule, [candle(1, 100.5, 102, 100.2, 101.5)]).activated,
      false,
    );
  });

  it("requires the close to come back — a pierce that stays through is a break", () => {
    assert.equal(
      evaluateActivationRule(rule, [candle(1, 100.5, 101, 98, 98.4)]).activated,
      false,
    );
  });

  it("is satisfied when price pierces the level and closes back above it", () => {
    const observation = evaluateActivationRule(rule, [candle(1, 100.6, 101.2, 98.4, 100.9)]);
    assert.equal(observation.activated, true);
    assert.equal(observation.evidence?.kind, "rejection_confirmed");
  });
});

describe("composite", () => {
  const all: ActivationRule = {
    kind: "composite",
    operator: "all",
    rules: [
      { kind: "candle_close_above", level: 100, timeframe: "1h" },
      { kind: "price_touch", level: 103, direction: "above", timeframe: "1h" },
    ],
  };

  it("with `all`, one satisfied leaf is not enough", () => {
    assert.equal(evaluateActivationRule(all, [CLOSE_ABOVE_100]).activated, false);
  });

  it("with `all`, activates once every leaf has been satisfied", () => {
    assert.equal(
      evaluateActivationRule(all, [CLOSE_ABOVE_100, candle(3, 101, 103.4, 100.9, 103.1)])
        .activated,
      true,
    );
  });

  it("with `any`, one satisfied leaf activates", () => {
    const any: ActivationRule = { ...all, operator: "any" };
    assert.equal(evaluateActivationRule(any, [CLOSE_ABOVE_100]).activated, true);
  });
});

describe("expiry", () => {
  it("an expired condition never activates, however convincing the candle", () => {
    const rule: ActivationRule = {
      kind: "candle_close_above",
      level: 100,
      timeframe: "1h",
      expiresAt: 1,
    };
    assert.equal(evaluateActivationRule(rule, [CLOSE_ABOVE_100]).activated, false);
  });

  it("a candle at the expiry boundary still counts", () => {
    const rule: ActivationRule = {
      kind: "candle_close_above",
      level: 100,
      timeframe: "1h",
      expiresAt: 2,
    };
    assert.equal(evaluateActivationRule(rule, [CLOSE_ABOVE_100]).activated, true);
  });
});

describe("idempotence", () => {
  it("repeated qualifying candles produce ONE activation, not one per candle", () => {
    const evaluator = createActivationEvaluator({
      kind: "candle_close_above",
      level: 100,
      timeframe: "1h",
    });
    const first = evaluator.observe(CLOSE_ABOVE_100);
    const second = evaluator.observe(candle(3, 101, 103, 100.8, 102.6));
    assert.equal(first.activated, true);
    assert.equal(second.activated, true);
    // Same evidence both times: the activation is the first one, not the latest.
    assert.equal(first.evidence?.at, 2);
    assert.equal(second.evidence?.at, 2);
  });
});

describe("parsing", () => {
  it("round-trips through storage", () => {
    const rule: ActivationRule = {
      kind: "retest_confirmed",
      level: 1.1025,
      direction: "above",
      retestZone: { low: 1.1, high: 1.1035 },
      timeframe: "15m",
    };
    const parsed = parseActivationRule(serializeActivationRule(rule));
    assert.deepEqual(parsed, rule);
  });

  it("returns null for malformed input rather than throwing", () => {
    assert.equal(parseActivationRule("not json"), null);
    assert.equal(parseActivationRule(null), null);
    assert.equal(parseActivationRule(""), null);
    assert.equal(parseActivationRule({ kind: "teleport", level: 1 }), null);
    // timeframe is OPTIONAL by design now: producers kept omitting it and the
    // plan's own timeframe is a mechanical default, filled by
    // normalizeActivationRule before storage. This parse must SUCCEED.
    assert.deepEqual(parseActivationRule({ kind: "candle_close_above", level: 100 }), {
      kind: "candle_close_above",
      level: 100,
    });
    // A retest with an inverted zone is incoherent.
    assert.equal(
      parseActivationRule({
        kind: "retest_confirmed",
        level: 100,
        direction: "above",
        timeframe: "1h",
        retestZone: { low: 101, high: 99 },
      }),
      null,
    );
  });

  it("an unreadable rule leaves the plan un-activatable", () => {
    // The safe direction: no rule means nothing fires, rather than falling back
    // to a touch.
    assert.equal(parseActivationRule("{}"), null);
  });
});

describe("explainActivationRuleIncoherence — issue-time price coherence", () => {
  // Regression: the XAUUSD conditional-sell incident. Sell plan, entry
  // 4348.27; the rule armed on an event whose relationship to the CURRENT
  // price made the stored condition grade a different event than the
  // sentence shown to the user.
  it("rejects a close-below sell trigger when price is already below the level", () => {
    const violation = explainActivationRuleIncoherence({
      rule: { kind: "candle_close_below", level: 4348.27, timeframe: "15m" },
      direction: "sell",
      currentPrice: 4340,
      tolerance: 0.5,
    });
    assert.ok(violation, "expected an already-satisfied violation");
    assert.match(violation!, /already satisfied/);
  });

  it("accepts the same rule when price is still above the level", () => {
    assert.equal(
      explainActivationRuleIncoherence({
        rule: { kind: "candle_close_below", level: 4348.27, timeframe: "15m" },
        direction: "sell",
        currentPrice: 4355,
        tolerance: 0.5,
      }),
      null,
    );
  });

  it("rejects a rejection_confirmed whose level price has already crossed beyond", () => {
    // Sentence says "price returns UP to 4348 and gets rejected", but price is
    // already above the level — the stored rule would grade a plain break.
    const violation = explainActivationRuleIncoherence({
      rule: {
        kind: "rejection_confirmed",
        level: 4348.27,
        direction: "below",
        timeframe: "15m",
      },
      direction: "sell",
      currentPrice: 4356,
      tolerance: 0.5,
    });
    assert.ok(violation, "expected a wrong-side violation");
    assert.match(violation!, /beyond it/);
  });

  it("accepts a coherent rejection sell: price below POI, awaiting return up into it", () => {
    assert.equal(
      explainActivationRuleIncoherence({
        rule: {
          kind: "rejection_confirmed",
          level: 4348.27,
          direction: "below",
          timeframe: "15m",
        },
        direction: "sell",
        currentPrice: 4330,
        tolerance: 0.5,
      }),
      null,
    );
  });

  it("rejects a breakout trigger that argues against the plan's direction", () => {
    const violation = explainActivationRuleIncoherence({
      rule: {
        kind: "breakout_confirmed",
        level: 4360,
        direction: "above",
        timeframe: "15m",
      },
      direction: "sell",
      currentPrice: 4340,
    });
    assert.ok(violation, "expected a direction contradiction");
    assert.match(violation!, /contradicts/);
  });

  it("checks every leaf of a composite", () => {
    const violation = explainActivationRuleIncoherence({
      rule: {
        kind: "composite",
        operator: "all",
        rules: [
          { kind: "price_touch", level: 4350, timeframe: "15m" },
          { kind: "candle_close_below", level: 4348, timeframe: "15m" },
        ],
      },
      direction: "sell",
      currentPrice: 4340,
    });
    assert.ok(violation, "expected the already-satisfied leaf to be flagged");
  });

  it("price_touch is never flagged (instant by design)", () => {
    assert.equal(
      explainActivationRuleIncoherence({
        rule: { kind: "price_touch", level: 4350, timeframe: "15m" },
        direction: "sell",
        currentPrice: 4340,
      }),
      null,
    );
  });
});

describe("describeActivationRule", () => {
  it("restates each kind for the operator", () => {
    assert.match(
      describeActivationRule({
        kind: "candle_close_above",
        level: 100,
        timeframe: "1h",
        closes: 2,
      }),
      /2/,
    );
    assert.match(
      describeActivationRule({
        kind: "composite",
        operator: "all",
        rules: [
          { kind: "price_touch", level: 100, direction: "above", timeframe: "1h" },
          { kind: "candle_close_above", level: 101, timeframe: "1h" },
        ],
      }),
      /100/,
    );
  });
});

describe("producer ergonomics — the traps that burned real runs", () => {
  it("a directionless price_touch means the candle range contained the level", () => {
    const rule: ActivationRule = { kind: "price_touch", level: 100 };
    // Touched from above on the way down.
    assert.equal(evaluateActivationRule(rule, [candle(1, 101, 102, 99.8, 100.5)]).activated, true);
    // Touched from below on the way up.
    assert.equal(evaluateActivationRule(rule, [candle(1, 99, 100.2, 98.5, 99.4)]).activated, true);
    // Never reached.
    assert.equal(evaluateActivationRule(rule, [candle(1, 95, 97, 94, 96)]).activated, false);
  });

  it("normalizeActivationRule fills ONLY the missing timeframe, from the plan", () => {
    const rule: ActivationRule = { kind: "candle_close_above", level: 100 };
    assert.deepEqual(normalizeActivationRule(rule, "15m"), {
      kind: "candle_close_above",
      level: 100,
      timeframe: "15m",
    });
    // A stated timeframe is never overwritten — the rule may genuinely mean 1h
    // on a 15m plan.
    const stated: ActivationRule = { kind: "candle_close_above", level: 100, timeframe: "1h" };
    assert.deepEqual(normalizeActivationRule(stated, "15m"), stated);
  });

  it("normalization reaches composite leaves too", () => {
    const rule: ActivationRule = {
      kind: "composite",
      operator: "all",
      rules: [
        { kind: "price_touch", level: 4000 },
        { kind: "candle_close_above", level: 4000, timeframe: "1h" },
      ],
    };
    const normalized = normalizeActivationRule(rule, "15m");
    assert.equal(normalized.kind, "composite");
    if (normalized.kind === "composite") {
      assert.equal(normalized.rules[0]!.timeframe, "15m");
      assert.equal(normalized.rules[1]!.timeframe, "1h");
    }
  });

  it("the exact shape the platform model emitted on 2026-07-28 now parses", () => {
    // Verbatim from the incident probe: a composite whose price_touch leaf has
    // no direction and no timeframe. Both production attempts died on this.
    const emitted = {
      kind: "composite",
      operator: "all",
      rules: [
        { kind: "price_touch", level: 4000 },
        { kind: "candle_close_above", level: 4000, timeframe: "15m" },
      ],
    };
    assert.ok(parseActivationRule(emitted));
  });
});

describe("normalizeActivationRule — instrument tolerance", () => {
  // The live incident (2026-08-24, XAUUSD): the STORED rule was exactly
  //   {"kind":"rejection_confirmed","level":4658.96,"direction":"below","timeframe":"15m"}
  // with no tolerance, so grading read `?? 0` and demanded an exact-cent
  // touch. Price came within a fraction of the entry, the rejection happened
  // on the chart, and the plan stayed unactivated — which also tells the
  // performance report a trade was never taken when it really was.
  const liveRule: ActivationRule = {
    kind: "rejection_confirmed",
    level: 4658.96,
    direction: "below",
    timeframe: "15m",
  };

  it("fills the tolerance a producer omitted", () => {
    const out = normalizeActivationRule(liveRule, "15m", 0.9);
    assert.equal("tolerance" in out ? out.tolerance : undefined, 0.9);
  });

  it("never overrides a tolerance the producer stated — including 0", () => {
    const explicit = normalizeActivationRule(
      { ...liveRule, tolerance: 0 },
      "15m",
      0.9,
    );
    assert.equal("tolerance" in explicit ? explicit.tolerance : undefined, 0);
  });

  it("changes nothing when the caller knows no instrument scale", () => {
    assert.deepEqual(normalizeActivationRule(liveRule, "15m"), liveRule);
    assert.deepEqual(normalizeActivationRule(liveRule, "15m", null), liveRule);
    assert.deepEqual(normalizeActivationRule(liveRule, "15m", 0), liveRule);
    assert.deepEqual(normalizeActivationRule(liveRule, "15m", NaN), liveRule);
  });

  it("still fills the timeframe default, and both at once", () => {
    const bare = { kind: "price_touch" as const, level: 4000 };
    const out = normalizeActivationRule(bare, "1h", 0.5);
    assert.equal(out.kind === "price_touch" ? out.timeframe : null, "1h");
    assert.equal(out.kind === "price_touch" ? out.tolerance : null, 0.5);
  });

  it("reaches every leaf of a composite", () => {
    const composite: ActivationRule = {
      kind: "composite",
      operator: "all" as const,
      rules: [
        { kind: "price_touch", level: 4000 },
        { kind: "candle_close_below", level: 3990, tolerance: 2 },
      ],
    };
    const out = normalizeActivationRule(composite, "15m", 0.5);
    assert.equal(out.kind, "composite");
    if (out.kind !== "composite") return;
    assert.equal(out.rules[0]!.tolerance, 0.5, "omitted → filled");
    assert.equal(out.rules[1]!.tolerance, 2, "stated → untouched");
    assert.ok(out.rules.every((r) => r.timeframe === "15m"));
  });

  it("turns the near-miss into the activation it always was", () => {
    // The candle that SHOULD have activated the live plan: it pierced to
    // within 0.3 of the level and closed decisively back below.
    const candle: TrackerCandle = {
      time: 1_787_600_000_000,
      open: 4652,
      high: 4658.66,
      low: 4650,
      close: 4651,
    };
    const graded = (rule: ActivationRule) =>
      evaluateActivationRule(rule, [candle]).activated;

    assert.equal(graded(liveRule), false, "exact-cent grading: the bug");
    assert.equal(
      graded(normalizeActivationRule(liveRule, "15m", 0.9)),
      true,
      "with the instrument's own tolerance the setup counts",
    );
  });
});
