/**
 * The structured activation rule, against a real database.
 *
 * The evaluator being correct is worth nothing if the rule does not survive
 * storage: a plan whose rule is dropped on write falls back to entry semantics
 * and fills on a touch — exactly the finding. These pin the round trip, and
 * that a revision reads back the rule in force rather than a superseded one.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import type { ActivationRule } from "@/lib/recommendations/activationRule";

const dir = mkdtempSync(join(tmpdir(), "aichart-activation-"));
process.env.DB_PATH = join(dir, "activation.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "activation-test-secret";
delete process.env.DATABASE_URL;

let owner = 0;
let counter = 0;

const RETEST_RULE: ActivationRule = {
  kind: "retest_confirmed",
  level: 3990,
  direction: "above",
  retestZone: { low: 3986, high: 3992 },
  timeframe: "15m",
  closes: 1,
};

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["activation-owner@example.com", "x", "user", "active"],
  );
});

async function newRecommendation(activationRule?: ActivationRule | null) {
  const lifecycle = await import("@/lib/recommendations/canonical");
  counter += 1;
  // A conditional plan REQUIRES a rule under the contract, so the no-rule case
  // is an immediate plan — the only honest plan type without one.
  const conditional = activationRule != null;
  return lifecycle.createCanonicalRecommendation({
    planType: conditional ? "conditional" : "immediate",
    executionState: conditional ? "awaiting_activation" : "valid_now",
    initialRevision: {
      activationCondition: conditional
        ? "كسر 3990 ثم إعادة اختباره وتأكيد الإغلاق"
        : null,
      activationRule,
      invalidationRule: "إغلاق 15m تحت 3980 يلغي الفكرة",
      alternativeScenario: "فشل الكسر يفتح بيعًا نحو 3970",
      validityCandles: 12,
    },
    userId: owner,
    analysisId: `analysis-${counter}`,
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "15m",
    direction: "buy",
    entry: 3992,
    stopLoss: 3986,
    targets: [4010],
    risk: { riskPercent: 1 },
    confidence: 70,
    strategyId: "unspecified",
    strategyVersion: "1",
  });
}

describe("activation rule persistence", () => {
  it("stores the rule on revision 1 and reads it back intact", async () => {
    const revisions = await import("@/lib/recommendations/canonical/revisions");
    const created = await newRecommendation(RETEST_RULE);
    const effective = await revisions.getEffectiveRevision(
      owner,
      created.recommendationId,
    );
    assert.equal(effective?.revisionNo, 1);
    assert.deepEqual(effective?.activationRule, RETEST_RULE);
    // The sentence and the rule are different facts and both survive.
    assert.match(String(effective?.activationCondition), /3990/);
  });

  it("a plan created without a rule reads back null, not a fabricated one", async () => {
    const revisions = await import("@/lib/recommendations/canonical/revisions");
    const created = await newRecommendation(null);
    const effective = await revisions.getEffectiveRevision(
      owner,
      created.recommendationId,
    );
    assert.equal(effective?.activationRule, null);
  });

  it("a revised plan is graded against the rule now in force", async () => {
    const revisions = await import("@/lib/recommendations/canonical/revisions");
    const created = await newRecommendation(RETEST_RULE);

    const stricter: ActivationRule = {
      kind: "candle_close_above",
      level: 3995,
      timeframe: "15m",
      closes: 2,
    };
    await revisions.applyRecommendationRevision({
      userId: owner,
      recommendationId: created.recommendationId,
      revision: {
        direction: "buy",
        planType: "conditional",
        executionState: "awaiting_activation",
        entry: 3996,
        stopLoss: 3988,
        targets: [4012],
        activationCondition: "إغلاق شمعتي 15m فوق 3995",
        activationRule: stricter,
        invalidationRule: "إغلاق تحت 3980",
        alternativeScenario: "فشل الاختراق",
        validityCandles: 12,
        reason: "deep research tightened the trigger",
        source: "deep_research",
      },
    });

    const effective = await revisions.getEffectiveRevision(
      owner,
      created.recommendationId,
    );
    assert.equal(effective?.revisionNo, 2);
    assert.deepEqual(effective?.activationRule, stricter);

    // Revision 1 is history, not a draft: its rule is untouched.
    const history = await revisions.listRevisions(
      owner,
      created.recommendationId,
    );
    const first = history.find((revision) => revision.revisionNo === 1);
    assert.deepEqual(first?.activationRule, RETEST_RULE);
  });

  it("a stored rule cannot be edited underneath the plan", async () => {
    const db = await import("@/lib/db");
    const created = await newRecommendation(RETEST_RULE);

    // Rewriting a revision's trigger in place would let a plan change what it
    // was waiting for without leaving a trace. The database refuses.
    await assert.rejects(
      db.execute(
        "UPDATE recommendation_revisions SET activation_rule_json = ? WHERE recommendation_id = ? AND revision_no = 1",
        ['{"kind":"price_touch","level":1,"direction":"above","timeframe":"1h"}', created.recommendationId],
      ),
      /append-only|immutable|TRIGGER/i,
    );
  });

  it("a rule the current build cannot grade is read as absent, never as a touch", async () => {
    const { parseActivationRule } = await import("@/lib/recommendations/activationRule");
    // The read path a revision goes through. An unreadable rule yields null,
    // and a null rule leaves the plan on entry semantics rather than inventing
    // a condition — the safe direction, and a visible one.
    assert.equal(parseActivationRule('{"kind":"teleport","level":1}'), null);
    assert.equal(parseActivationRule(null), null);
  });
});
