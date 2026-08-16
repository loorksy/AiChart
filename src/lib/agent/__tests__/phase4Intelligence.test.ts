import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_LESSON_SAMPLE,
  renderLessonsForPrompt,
  summarizeTradeLessons,
  type TradeOutcomeRecord,
} from "@/lib/agent/learningLoop";
import { evaluateLifecycle } from "@/lib/strategies/decayLifecycle";

const outcome = (over: Partial<TradeOutcomeRecord> = {}): TradeOutcomeRecord => ({
  symbol: "XAUUSD",
  direction: "buy",
  won: false,
  rMultiple: -1,
  session: "asia",
  closedAt: 1_000,
  ...over,
});

describe("learning loop (item 14): evidence, never a veto", () => {
  it("claims no pattern below the minimum sample", () => {
    const s = summarizeTradeLessons({
      symbol: "XAUUSD",
      outcomes: Array.from({ length: MIN_LESSON_SAMPLE - 1 }, (_, i) =>
        outcome({ closedAt: i }),
      ),
    });
    assert.equal(s.insufficient, true);
    assert.deepEqual(s.weakSessions, [], "a thin sample must assert nothing");
    assert.equal(s.weakDirection, null);
  });

  it("surfaces a session concentration as a quantified observation", () => {
    const s = summarizeTradeLessons({
      symbol: "XAUUSD",
      outcomes: [
        outcome({ won: false, session: "asia", closedAt: 5 }),
        outcome({ won: false, session: "asia", closedAt: 4 }),
        outcome({ won: false, session: "asia", closedAt: 3 }),
        outcome({ won: true, session: "london", closedAt: 2, rMultiple: 2 }),
        outcome({ won: true, session: "london", closedAt: 1, rMultiple: 1 }),
      ],
    });
    assert.deepEqual(s.weakSessions, ["asia"]);
    assert.match(s.notes.join(" "), /3 من آخر 3/);
    assert.equal(s.wins, 2);
    assert.equal(s.losses, 3);
  });

  it("only compares directions when BOTH have a real sample", () => {
    const s = summarizeTradeLessons({
      symbol: "XAUUSD",
      outcomes: [
        ...Array.from({ length: 5 }, (_, i) => outcome({ direction: "buy", won: false, closedAt: i })),
        outcome({ direction: "sell", won: true, closedAt: 9 }),
      ],
    });
    assert.equal(s.weakDirection, null, "one sell is not a comparison");
  });

  it("renders lessons as context to weigh, never as an instruction", () => {
    const s = summarizeTradeLessons({
      symbol: "XAUUSD",
      outcomes: Array.from({ length: 6 }, (_, i) =>
        outcome({ won: i % 2 === 0, closedAt: i, rMultiple: i % 2 === 0 ? 2 : -1 }),
      ),
    });
    const text = renderLessonsForPrompt(s) ?? "";
    assert.match(text, /سياق تزنه/, "must be framed as evidence");
    assert.doesNotMatch(text, /لا تتداول|امتنع|يجب عليك/, "must never issue a directive");
  });

  it("returns null when there is nothing to say", () => {
    assert.equal(renderLessonsForPrompt(summarizeTradeLessons({ symbol: "X", outcomes: [] })), null);
  });

  it("ignores other symbols entirely", () => {
    const s = summarizeTradeLessons({
      symbol: "XAUUSD",
      outcomes: [outcome({ symbol: "EURUSD" }), outcome({ symbol: "EURUSD" })],
    });
    assert.equal(s.sampleSize, 0);
  });
});

// --- Item 19a: decay lifecycle ----------------------------------------------

describe("decay lifecycle (item 19a)", () => {
  const expected = { winRate: 0.6, profitFactor: 1.8 };

  it("does not judge below the minimum live sample", () => {
    const e = evaluateLifecycle({
      current: "active",
      live: { sampleSize: 5, winRate: 0, profitFactor: 0.1, sharpeRatio: -2 },
      expected,
    });
    assert.equal(e.state, "active", "noise must not demote a healthy strategy");
  });

  it("moves to monitoring on a mild shortfall", () => {
    const e = evaluateLifecycle({
      current: "active",
      live: { sampleSize: 30, winRate: 0.48, profitFactor: 1.3, sharpeRatio: 0.4 },
      expected,
    });
    assert.equal(e.state, "monitoring");
    assert.equal(e.usableAsExecutionEvidence, true, "monitoring still counts as evidence");
  });

  it("marks a clear shortfall decayed and drops it as execution evidence", () => {
    const e = evaluateLifecycle({
      current: "monitoring",
      live: { sampleSize: 40, winRate: 0.35, profitFactor: 1.2, sharpeRatio: 0.1 },
      expected,
    });
    assert.equal(e.state, "decayed");
    assert.equal(e.usableAsExecutionEvidence, false);
  });

  it("disables immediately when the profit factor collapses to break-even", () => {
    const e = evaluateLifecycle({
      current: "active",
      live: { sampleSize: 25, winRate: 0.59, profitFactor: 0.95, sharpeRatio: 0.2 },
      expected,
    });
    assert.equal(e.state, "disabled", "no edge left, whatever the win rate");
    assert.equal(e.usableAsExecutionEvidence, false);
  });

  it("never auto-revives a disabled strategy", () => {
    const e = evaluateLifecycle({
      current: "disabled",
      live: { sampleSize: 500, winRate: 0.9, profitFactor: 5, sharpeRatio: 3 },
      expected,
    });
    assert.equal(e.state, "disabled", "re-enabling is an operator decision");
  });

  it("requires a demonstrated streak before promoting back up", () => {
    const healthy = { sampleSize: 40, winRate: 0.61, profitFactor: 1.9, sharpeRatio: 1.2 };
    const first = evaluateLifecycle({ current: "monitoring", live: healthy, expected, healthyStreak: 0 });
    assert.equal(first.state, "monitoring", "one good reading is not a recovery");
    assert.equal(first.healthyStreak, 1);

    const second = evaluateLifecycle({
      current: "monitoring",
      live: healthy,
      expected,
      healthyStreak: first.healthyStreak,
    });
    assert.equal(second.state, "active", "recovery must be demonstrated, then it counts");
  });

  it("downgrades immediately but upgrades slowly (asymmetric by design)", () => {
    const bad = evaluateLifecycle({
      current: "active",
      live: { sampleSize: 40, winRate: 0.3, profitFactor: 1.1, sharpeRatio: -0.2 },
      expected,
      healthyStreak: 5,
    });
    assert.equal(bad.state, "decayed");
    assert.equal(bad.healthyStreak, 0, "a downgrade resets any accumulated recovery");
  });
});
