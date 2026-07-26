import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-reeval-"));
process.env.DB_PATH = join(dir, "reeval.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "reeval-test-secret";
delete process.env.DATABASE_URL;

/**
 * Re-evaluation triggers, against a real database.
 *
 * The constitutional rule these enforce is an ORDERING: the tracker notices, the
 * brain decides, the revision mechanism applies. If the tracker could act on what
 * it notices there would be two deciders, and the second would be a heuristic
 * with no evidence bundle and no decision trace behind it.
 */

let db: typeof import("@/lib/db");
let triggers: typeof import("@/lib/recommendations/reevaluationTriggers");

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  triggers = await import("@/lib/recommendations/reevaluationTriggers");
});

function plan(over: Partial<Parameters<
  typeof import("@/lib/recommendations/reevaluationTriggers").detectReevaluationTriggers
>[0]["recommendation"]> = {}) {
  return {
    id: "rec-1",
    userId: 1,
    symbol: "XAUUSD",
    direction: "buy" as const,
    entry: 4000,
    stopLoss: 3980,
    revisionNo: 1,
    ...over,
  };
}

describe("detecting what warrants a new decision cycle", () => {
  it("raises on a structure break against the plan", () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan(),
      structure: { bias: "down", brokeSinceLastSweep: true },
    });
    assert.equal(found.length, 1);
    assert.equal(found[0]!.reason, "structure_break");
    assert.equal(found[0]!.source, "tracker");
  });

  it("stays quiet on a break that confirms the plan", () => {
    // A break in the plan's own direction is not news.
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan({ direction: "buy" }),
      structure: { bias: "up", brokeSinceLastSweep: true },
    });
    assert.deepEqual(found, []);
  });

  it("raises when the founding pattern completes, and when it fails", () => {
    for (const [stage, reason] of [
      ["completed", "pattern_completed"],
      ["confirmed", "pattern_completed"],
      ["failed", "pattern_failed"],
      ["invalidated", "pattern_failed"],
    ] as const) {
      const found = triggers.detectReevaluationTriggers({
        recommendation: plan({ foundingPattern: "ascending_triangle" }),
        patternStage: stage,
      });
      assert.equal(found[0]?.reason, reason, `stage ${stage}`);
    }
  });

  it("ignores a pattern stage when the plan was not founded on one", () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan(),
      patternStage: "completed",
    });
    assert.deepEqual(found, []);
  });

  it("raises when the spread breaks the plan's economics", () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan(),
      spread: { now: 0.6, plannedFor: 0.3 },
    });
    assert.equal(found[0]?.reason, "spread_widened");
    // The cost changes the plan's type and state, never its direction — which is
    // exactly why this is a request to re-decide and not an edit.
    assert.match(found[0]!.detail, /الجدوى/);
  });

  it("tolerates a spread that is merely worse", () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan(),
      spread: { now: 0.4, plannedFor: 0.3 },
    });
    assert.deepEqual(found, []);
  });

  it("raises when the higher timeframe turns against the plan", () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan({ direction: "sell" }),
      higherTimeframeBias: "up",
    });
    assert.equal(found[0]?.reason, "higher_timeframe_reversal");
  });

  it("raises once for an imminent release, not once per event", () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan(),
      upcomingEvents: [
        { title: "CPI", minutesAway: 12, impact: "high" },
        { title: "Fed speaker", minutesAway: 20, impact: "medium" },
      ],
    });
    assert.equal(found.filter((t) => t.reason === "economic_event").length, 1);
  });

  it("invents nothing when the calendar is unavailable", () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan(),
      upcomingEvents: null,
    });
    assert.deepEqual(found, []);
  });

  it("returns nothing on a quiet sweep", () => {
    // The common case. A tracker that finds a reason every sweep is a tracker
    // that would re-decide constantly.
    assert.deepEqual(triggers.detectReevaluationTriggers({ recommendation: plan() }), []);
  });
});

describe("bounding automatic cycles", () => {
  it("admits the first trigger and records it", async () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan({ id: "rec-admit" }),
      structure: { bias: "down", brokeSinceLastSweep: true },
    });
    const { admitted } = await triggers.admitTriggers(found);
    assert.equal(admitted.length, 1);
    await triggers.recordTrigger(admitted[0]!, "cycle_requested");

    const history = await triggers.listTriggers("rec-admit");
    assert.equal(history.length, 1);
    assert.equal(history[0]!.outcome, "cycle_requested");
    assert.equal(history[0]!.reason, "structure_break");
  });

  it("holds a second cycle inside the cooldown", async () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan({ id: "rec-admit", revisionNo: 2 }),
      higherTimeframeBias: "down",
    });
    const { admitted, suppressed } = await triggers.admitTriggers(found);
    // A model call per sweep would be noise for the operator and cost for nobody.
    assert.equal(admitted.length, 0);
    assert.equal(suppressed, 1);
  });

  it("asks for one cycle even when several things changed at once", async () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan({ id: "rec-multi" }),
      structure: { bias: "down", brokeSinceLastSweep: true },
      higherTimeframeBias: "down",
      spread: { now: 1, plannedFor: 0.3 },
    });
    assert.ok(found.length >= 3, "expected several detected reasons");
    const { admitted } = await triggers.admitTriggers(found);
    assert.equal(admitted.length, 1, "several reasons are one reason to re-decide");
  });

  it("never rate-limits what the operator asked for", async () => {
    const request = {
      recommendationId: "rec-admit",
      userId: 1,
      symbol: "XAUUSD",
      reason: "user_request" as const,
      detail: "المستخدم طلب إعادة التقييم.",
      source: "user" as const,
      revisionNo: 2,
      raisedAt: Date.now(),
    };
    const { admitted } = await triggers.admitTriggers([request]);
    // The limits exist to bound automatic spend. The operator asking is not
    // automatic, and inside a cooldown that would otherwise suppress it.
    assert.equal(admitted.length, 1);
  });

  it("records a suppressed trigger too, so the silence is explainable", async () => {
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan({ id: "rec-suppressed" }),
      structure: { bias: "down", brokeSinceLastSweep: true },
    });
    await triggers.recordTrigger(found[0]!, "suppressed");
    const history = await triggers.listTriggers("rec-suppressed");
    assert.equal(history[0]!.outcome, "suppressed");
  });

  it("is idempotent for the same reason at the same revision", async () => {
    const trigger = {
      recommendationId: "rec-idem",
      userId: 1,
      symbol: "XAUUSD",
      reason: "spread_widened" as const,
      detail: "x",
      source: "tracker" as const,
      revisionNo: 3,
      raisedAt: Date.now(),
    };
    await triggers.recordTrigger(trigger, "cycle_requested");
    await triggers.recordTrigger(trigger, "cycle_requested");
    assert.equal((await triggers.listTriggers("rec-idem")).length, 1);
  });

  it("admits nothing when the phase is rolled back", async () => {
    const { clearPlatformConfigCache } = await import("@/lib/platformConfig");
    process.env.REEVALUATION_TRIGGERS_V1 = "0";
    clearPlatformConfigCache();
    const found = triggers.detectReevaluationTriggers({
      recommendation: plan({ id: "rec-off" }),
      structure: { bias: "down", brokeSinceLastSweep: true },
    });
    const { admitted, suppressed } = await triggers.admitTriggers(found);
    assert.equal(admitted.length, 0);
    assert.equal(suppressed, found.length);
    delete process.env.REEVALUATION_TRIGGERS_V1;
    clearPlatformConfigCache();
  });
});

describe("the tracker notices but never decides", () => {
  /**
   * The ordering, asserted structurally. A tracker that calls the revision
   * mechanism or the decision engine has become a second brain.
   */
  it("does not call the revision mechanism or the decision engine", () => {
    const tracker = readFileSync(
      resolve(process.cwd(), "src/lib/recommendations/recommendationTracker.ts"),
      "utf8",
    );
    assert.ok(
      !/applyRecommendationRevision\s*\(/.test(tracker),
      "the tracker must raise a trigger, not apply a revision",
    );
    assert.ok(
      !/runFinalDecisionSynthesizer\s*\(/.test(tracker),
      "the tracker must not invoke the decision engine inline",
    );
    // And it must actually raise them, or the constitution rule is unimplemented.
    assert.ok(
      /detectReevaluationTriggers\s*\(/.test(tracker),
      "the tracker must detect re-evaluation triggers",
    );
  });

  it("keeps the trigger module free of any decision or plan write", () => {
    const module = readFileSync(
      resolve(process.cwd(), "src/lib/recommendations/reevaluationTriggers.ts"),
      "utf8",
    );
    // A CALL, not a mention: the module's own comment names the mechanism while
    // explaining the ordering, which is exactly the documentation we want.
    assert.ok(
      !/\bawait\s+applyRecommendationRevision\s*\(|^\s*applyRecommendationRevision\s*\(/m.test(
        module,
      ),
      "the trigger module must not apply revisions",
    );
    assert.ok(
      !/^import[\s\S]*applyRecommendationRevision/m.test(module),
      "the trigger module must not even import the revision mechanism",
    );
    assert.ok(
      !/UPDATE\s+recommendations/i.test(module),
      "a trigger module must never write a plan column",
    );
    // The trigger SHAPE carries no direction at all. A trigger says why to look
    // again; concluding what to do is the brain's output, not the tracker's.
    const shape = /export interface ReevaluationTrigger \{[\s\S]*?\n\}/.exec(module);
    assert.ok(shape, "ReevaluationTrigger moved — update this guard");
    assert.ok(
      !/\bdirection\b/.test(shape[0]),
      "a trigger must not carry a direction: that would make it a decision",
    );
  });
});
