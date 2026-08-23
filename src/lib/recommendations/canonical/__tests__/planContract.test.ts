/**
 * The Complete Plan Contract — the validator itself, then the choke point.
 *
 * High #1: the MCP surface could store a plan with every layer-3 column NULL.
 * These pin the two halves of the fix: the shared rule set grades identically
 * for every surface, and the canonical creator refuses what fails it — with
 * the single, explicit legacy exemption.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import {
  validateCompletePlan,
  type PlanContractInput,
} from "@/lib/recommendations/canonical/planContract";

const dir = mkdtempSync(join(tmpdir(), "aichart-plan-contract-"));
process.env.DB_PATH = join(dir, "contract.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "plan-contract-test";
delete process.env.DATABASE_URL;

/** A complete immediate plan; each test breaks exactly one thing. */
function completeImmediate(): PlanContractInput {
  return {
    direction: "buy",
    planType: "immediate",
    executionState: "valid_now",
    entry: 4000,
    stopLoss: 3980,
    targets: [4040],
    invalidationRule: "إغلاق شمعة ساعة تحت 3980 يلغي الفكرة",
    alternativeScenario: "كسر 3980 يفتح مسارًا هابطًا نحو 3950",
    validityCandles: 12,
  };
}

function completeConditional(): PlanContractInput {
  return {
    ...completeImmediate(),
    planType: "conditional",
    executionState: "awaiting_activation",
    activationCondition: "إغلاق شمعة ساعة فوق 4005 يفعّل الخطة",
    activationRule: { kind: "candle_close_above", level: 4005, timeframe: "1h" },
  };
}

function paths(input: PlanContractInput): string[] {
  return validateCompletePlan(input).map((issue) => issue.path);
}

describe("validateCompletePlan", () => {
  it("accepts a complete plan of each type", () => {
    assert.deepEqual(paths(completeImmediate()), []);
    assert.deepEqual(paths(completeConditional()), []);
    assert.deepEqual(
      paths({ ...completeConditional(), planType: "anticipatory" }),
      [],
    );
  });

  it("never grades a WAIT — refused elsewhere, not passable here", () => {
    assert.deepEqual(paths({ direction: "wait" }), []);
  });

  it("rejects a null or unknown execution state", () => {
    assert.ok(paths({ ...completeImmediate(), executionState: null }).includes("executionState"));
    assert.ok(
      paths({ ...completeImmediate(), executionState: "maybe" }).includes("executionState"),
    );
  });

  it("rejects a missing or unknown plan type", () => {
    assert.ok(paths({ ...completeImmediate(), planType: null }).includes("planType"));
    assert.ok(paths({ ...completeImmediate(), planType: "someday" }).includes("planType"));
  });

  it("rejects missing levels", () => {
    assert.ok(paths({ ...completeImmediate(), entry: null }).includes("entry"));
    assert.ok(paths({ ...completeImmediate(), stopLoss: null }).includes("stopLoss"));
    assert.ok(paths({ ...completeImmediate(), targets: [] }).includes("targets"));
  });

  it("rejects a missing invalidation rule — for every plan type", () => {
    for (const base of [completeImmediate(), completeConditional()]) {
      assert.ok(paths({ ...base, invalidationRule: null }).includes("invalidationRule"));
      assert.ok(paths({ ...base, invalidationRule: "قصير" }).includes("invalidationRule"));
    }
  });

  it("rejects a missing alternative scenario and missing validity", () => {
    assert.ok(
      paths({ ...completeImmediate(), alternativeScenario: null }).includes(
        "alternativeScenario",
      ),
    );
    assert.ok(
      paths({ ...completeImmediate(), validityCandles: null }).includes("validityCandles"),
    );
    assert.ok(
      paths({ ...completeImmediate(), validityCandles: 0 }).includes("validityCandles"),
    );
    assert.ok(
      paths({ ...completeImmediate(), validityCandles: 97 }).includes("validityCandles"),
    );
  });

  it("rejects identical invalidation and alternative — filler is not a plan", () => {
    const same = "نفس الجملة المكررة لتجاوز الفاحص فقط";
    assert.ok(
      paths({
        ...completeImmediate(),
        invalidationRule: same,
        alternativeScenario: same,
      }).includes("alternativeScenario"),
    );
  });

  it("a conditional plan requires both the sentence and the structured rule", () => {
    assert.ok(
      paths({ ...completeConditional(), activationCondition: null }).includes(
        "activationCondition",
      ),
    );
    assert.ok(
      paths({ ...completeConditional(), activationRule: null }).includes("activationRule"),
    );
    assert.ok(
      paths({
        ...completeConditional(),
        activationRule: { kind: "teleport" } as never,
      }).includes("activationRule"),
    );
  });

  it("an anticipatory plan requires the activation pair too", () => {
    const anticipatory = { ...completeConditional(), planType: "anticipatory" };
    assert.ok(paths({ ...anticipatory, activationRule: null }).includes("activationRule"));
  });

  it("a conditional plan cannot claim valid_now", () => {
    assert.ok(
      paths({ ...completeConditional(), executionState: "valid_now" }).includes(
        "executionState",
      ),
    );
  });

  it("an immediate plan MAY carry an activation condition — never required to drop it", () => {
    assert.deepEqual(
      paths({
        ...completeImmediate(),
        activationCondition: "لمس منطقة الدخول حول 4000",
      }),
      [],
    );
  });
});

describe("the canonical creator enforces the contract", () => {
  let owner = 0;

  before(async () => {
    const db = await import("@/lib/db");
    await db.initDb();
    owner = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      ["contract-owner@example.com", "x", "user", "active"],
    );
  });

  function baseCreate() {
    return {
      userId: owner,
      symbol: "XAUUSD",
      market: "forex",
      timeframe: "1h",
      direction: "buy" as const,
      entry: 4000,
      stopLoss: 3980,
      targets: [4040],
      risk: {},
      confidence: 70,
      strategyId: "unspecified",
      strategyVersion: "1",
      source: "test",
      engineVersion: "plan-contract-test",
    };
  }

  it("refuses an incomplete buy — no plan layers at all", async () => {
    const { createCanonicalRecommendation } = await import(
      "@/lib/recommendations/canonical"
    );
    await assert.rejects(
      createCanonicalRecommendation(baseCreate()),
      (error: { code?: string; message?: string }) =>
        error.code === "RECOMMENDATION_INVALID_INPUT" &&
        /planType/.test(String(error.message)),
    );
  });

  it("refuses a conditional plan whose seed has no activation rule", async () => {
    const { createCanonicalRecommendation } = await import(
      "@/lib/recommendations/canonical"
    );
    await assert.rejects(
      createCanonicalRecommendation({
        ...baseCreate(),
        planType: "conditional",
        executionState: "awaiting_activation",
        initialRevision: {
          activationCondition: "إغلاق شمعة ساعة فوق 4005",
          invalidationRule: "إغلاق تحت 3980 يلغي الفكرة",
          alternativeScenario: "كسر 3980 يفتح بيعًا نحو 3950",
          validityCandles: 12,
        },
      }),
      (error: { message?: string }) => /activationRule/.test(String(error.message)),
    );
  });

  it("accepts the same conditional plan once the rule is present, and stores it", async () => {
    const { createCanonicalRecommendation } = await import(
      "@/lib/recommendations/canonical"
    );
    const { getEffectiveRevision } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    const { completePlanEvidence, seedPassedGateChain } = await import(
      "@/lib/recommendations/__tests__/fixtures/completePlan"
    );
    const db = await import("@/lib/db");
    // The accept path stores for real, so it must satisfy the full write
    // boundary: a recorded gate chain and a sourced evidence card.
    await seedPassedGateChain(owner, "plan-contract-accept", "XAUUSD");
    const created = await createCanonicalRecommendation({
      ...baseCreate(),
      analysisId: "plan-contract-accept",
      planType: "conditional",
      executionState: "awaiting_activation",
      initialRevision: {
        activationCondition: "إغلاق شمعة ساعة فوق 4005",
        activationRule: { kind: "candle_close_above", level: 4005, timeframe: "1h" },
        invalidationRule: "إغلاق تحت 3980 يلغي الفكرة",
        alternativeScenario: "كسر 3980 يفتح بيعًا نحو 3950",
        validityCandles: 12,
        evidence: completePlanEvidence(),
      },
    });
    const effective = await getEffectiveRevision(owner, created.recommendationId);
    assert.equal(effective?.planType, "conditional");
    assert.equal(effective?.executionState, "awaiting_activation");
    assert.equal(effective?.activationRule?.kind, "candle_close_above");
    // The row itself carries the layers — not only the revision pointer, so a
    // failed best-effort seed can never leave them NULL.
    const row = await db.queryOne<{ plan_type: string; execution_state: string }>(
      "SELECT plan_type, execution_state FROM recommendations WHERE id = ?",
      [created.recommendationId],
    );
    assert.equal(row?.plan_type, "conditional");
    assert.equal(row?.execution_state, "awaiting_activation");
  });

  it("legacyImport bypasses the contract — history stays readable", async () => {
    const { createCanonicalRecommendation } = await import(
      "@/lib/recommendations/canonical"
    );
    const created = await createCanonicalRecommendation({
      ...baseCreate(),
      legacyImport: true,
    });
    assert.ok(created.recommendationId > 0);
  });

  it("a WAIT row is not graded by the contract", async () => {
    const { createCanonicalRecommendation } = await import(
      "@/lib/recommendations/canonical"
    );
    const created = await createCanonicalRecommendation({
      ...baseCreate(),
      direction: "wait",
      entry: null,
      stopLoss: null,
      targets: [],
    });
    assert.ok(created.recommendationId > 0);
  });
});

describe("the reward:risk floor", () => {
  // The first live recommendation was entry 4602 / stop 4578 (24 points)
  // for a 4623.79 target (22 points) — under 1:1. A book of those grades as
  // a disaster in the forward record however sound each read was.
  const tight = (): PlanContractInput => ({
    ...completeImmediate(),
    entry: 4602,
    stopLoss: 4578,
    targets: [4623.79],
  });

  it("refuses a plan below the admin's floor, and names why", () => {
    const issues = validateCompletePlan({ ...tight(), minRrFirstTargetBp: 200 });
    const target = issues.find((i) => i.path === "targets");
    assert.ok(target, "the plan must be refused");
    assert.match(target.message, /0\.9\d:1/, "the real ratio is stated");
    assert.match(target.message, /2\.00:1/, "so is the required one");
  });

  it("accepts the SAME read once the geometry earns it", () => {
    // The agent decides HOW: a wider target on real structure, or a tighter
    // stop the structure justifies. The contract only sets the bar.
    const wider = validateCompletePlan({
      ...tight(),
      targets: [4650],
      minRrFirstTargetBp: 200,
    });
    assert.deepEqual(wider, [], "48 points against 24 is 2:1");
  });

  it("judges the FIRST target — later targets are optional upside", () => {
    const issues = validateCompletePlan({
      ...tight(),
      targets: [4623.79, 4900],
      minRrFirstTargetBp: 200,
    });
    assert.ok(
      issues.some((i) => i.path === "targets"),
      "a distant TP2 cannot rescue a TP1 nobody will reach",
    );
  });

  it("with no floor configured (0), nothing is imposed", () => {
    assert.deepEqual(validateCompletePlan({ ...tight(), minRrFirstTargetBp: 0 }), []);
    assert.deepEqual(validateCompletePlan(tight()), []);
  });

  it("a stop sitting on the entry is refused as a non-risk", () => {
    const issues = validateCompletePlan({
      ...completeImmediate(),
      entry: 4000,
      stopLoss: 4000,
      targets: [4040],
      minRrFirstTargetBp: 200,
    });
    assert.ok(issues.some((i) => i.path === "stopLoss"));
  });
});
