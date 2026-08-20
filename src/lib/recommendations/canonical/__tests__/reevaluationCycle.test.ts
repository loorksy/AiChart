import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-reeval-cycle-"));
process.env.DB_PATH = join(dir, "cycle.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "cycle-test-secret";
delete process.env.DATABASE_URL;

/**
 * The full re-evaluation cycle, through the database.
 *
 * Trigger → fresh bundle → the same brain → compare → confirm or revise. The
 * brain is injected so the COMPARISON is what gets exercised; everything else —
 * the lock, the effective-revision read, the revision write, the append-only
 * history, the recorded verdict — runs for real.
 *
 * The half that existed before recorded triggers and stopped. A trigger that
 * nothing consumes is a note in a table, not a re-evaluation.
 */

let db: typeof import("@/lib/db");
let cycle: typeof import("@/lib/recommendations/reevaluationCycle");
let revisions: typeof import("@/lib/recommendations/canonical/revisions");
let repository: typeof import("@/lib/recommendations/canonical/repository");
let reevaluationTriggers: typeof import("@/lib/recommendations/reevaluationTriggers");
let locks: typeof import("@/lib/locks");
let userId = 0;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  cycle = await import("@/lib/recommendations/reevaluationCycle");
  revisions = await import("@/lib/recommendations/canonical/revisions");
  repository = await import("@/lib/recommendations/canonical/repository");
  reevaluationTriggers = await import("@/lib/recommendations/reevaluationTriggers");
  locks = await import("@/lib/locks");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["cycle@example.com", "x", "user", "active"],
  );
  // Lifecycle tests model paying subscribers — the 3-recommendation trial
  // cap is covered by the subscription suite, not here.
  await db.execute(
    "INSERT INTO user_entitlements (user_id, plan_status) VALUES (?, 'active')",
    [userId],
  );
});

let planSequence = 0;

/** A live plan with an effective revision, created the way the platform does. */
async function livePlan(): Promise<number> {
  const { seedPassedGateChain, completePlanEvidence } = await import(
    "@/lib/recommendations/__tests__/fixtures/completePlan"
  );
  const analysisId = `cycle-analysis-${Date.now()}-${++planSequence}`;
  await seedPassedGateChain(userId, analysisId, "XAUUSD");
  const rec = await repository.createCanonicalRecommendation({
    userId,
    analysisId,
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "5m",
    direction: "buy",
    entry: 4000,
    stopLoss: 3980,
    targets: [4040],
    planType: "conditional",
    executionState: "awaiting_activation",
    status: "active",
    source: "test",
    engineVersion: "cycle-test",
    initialRevision: {
      activationCondition: "إغلاق فوق 4002",
      activationRule: { kind: "candle_close_above", level: 4002, timeframe: "5m" },
      invalidationRule: "إغلاق تحت 3980",
      alternativeScenario: "كسر 3980 يقلب المشهد",
      validityCandles: 8,
      evidence: { ...completePlanEvidence(), atr: 4 },
    },
  });
  return rec.recommendationId;
}

function trigger(over: Partial<import("@/lib/recommendations/reevaluationTriggers").ReevaluationTrigger> = {}) {
  return {
    recommendationId: "rec-cycle",
    userId,
    symbol: "XAUUSD",
    reason: "structure_break" as const,
    detail: "كسر هيكلي ضد اتجاه الخطة",
    source: "tracker" as const,
    revisionNo: 1,
    raisedAt: Date.now(),
    ...over,
  };
}

/** A brain answer. Same shape the orchestrator returns. */
function brainResult(over: {
  direction?: "buy" | "sell";
  planType?: string;
  entry?: number;
  stopLoss?: number;
  targets?: number[];
  validityCandles?: number;
  alternativeScenario?: string;
  executionState?: string;
} = {}) {
  return {
    decision: over.direction ?? "buy",
    confidence: 62,
    summary: "قرار إعادة التقييم.",
    keyReasons: ["الهيكل"],
    riskWarnings: [],
    activityEvents: [],
    decisionTrace: {
      hypotheses: [{ scenario: "ارتداد", supporting: ["هيكل"], opposing: [] }],
      chosenBecause: "الطلب صمد.",
      planTypeBecause: "السعر بعيد.",
    },
    evidenceDimensions: [{ key: "signal_strength", grade: "moderate", detail: "x" }],
    evidenceSnapshot: {
      schemaVersion: 1,
      modelContext: { signalStrength: "moderate", symbol: "XAUUSD" },
      visualSnapshots: [],
    },
    recommendation: {
      action: over.direction ?? "buy",
      planType: over.planType ?? "conditional",
      executionState: over.executionState ?? "awaiting_activation",
      entry: over.entry ?? 4000,
      stop_loss: over.stopLoss ?? 3980,
      targets: over.targets ?? [4040],
      validityCandles: over.validityCandles ?? 8,
      alternativeScenario: over.alternativeScenario ?? "كسر 3980 يقلب المشهد",
      invalidationRule: "إغلاق تحت 3980",
      triggerCondition: "إغلاق فوق 4002",
    },
  } as unknown as import("@/lib/agent/types").AgentFinalResult;
}

describe("an unchanged decision confirms without inventing a revision", () => {
  it("records confirmed and leaves the effective revision alone", async () => {
    const id = await livePlan();
    const result = await cycle.runReevaluationCycle(trigger(), id, {
      // Same plan back: the market moved, the agent looked, the plan stands.
      runBrain: async () => brainResult(),
    });

    assert.equal(result.verdict, "confirmed");
    assert.equal(result.revision, null);
    assert.ok(result.evidenceHash, "a confirmed verdict must still carry its evidence hash");

    // Exactly one revision — the seed. An identical revision per sweep would bury
    // the real changes and make the revision number meaningless.
    const all = await revisions.listRevisions(userId, id);
    assert.equal(all.length, 1);
    assert.equal(all[0]!.revisionNo, 1);
  });

  it("makes the confirmation visible, because silence means something else", async () => {
    const id = await livePlan();
    await cycle.runReevaluationCycle(trigger({ recommendationId: `rec-${id}` }), id, {
      runBrain: async () => brainResult(),
    });
    const rows = await db.query<{ outcome: string; evidence_hash: string | null }>(
      "SELECT outcome, evidence_hash FROM recommendation_reevaluations WHERE recommendation_id = ?",
      [`rec-${id}`],
    );
    // "Looked and stood by it" is different information from "nobody looked".
    assert.equal(rows[0]?.outcome, "confirmed");
    assert.ok(rows[0]?.evidence_hash);
  });
});

describe("a changed decision produces a revision through the one mechanism", () => {
  it("revises when the levels move", async () => {
    const id = await livePlan();
    const result = await cycle.runReevaluationCycle(trigger(), id, {
      runBrain: async () => brainResult({ entry: 3990, stopLoss: 3972 }),
    });

    assert.equal(result.verdict, "revised");
    assert.equal(result.revision?.revisionNo, 2);
    assert.equal(result.revision?.entry, 3990);
    assert.equal(result.revision?.source, "market_update");
    assert.match(result.revision!.reason, /إعادة تقييم/);

    // The plan's pointer moved, and revision 1 is now stale for execution — which
    // is the whole point of routing through the revision mechanism.
    const stale = await revisions.checkRevisionIsCurrent({
      userId,
      recommendationId: id,
      revisionNo: 1,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "stale_revision");
  });

  it("revises on a direction flip", async () => {
    const id = await livePlan();
    const result = await cycle.runReevaluationCycle(trigger(), id, {
      runBrain: async () => brainResult({ direction: "sell", stopLoss: 4020, targets: [3960] }),
    });
    assert.equal(result.verdict, "revised");
    assert.equal(result.revision?.direction, "sell");
  });

  it("revises on a plan-type change alone", async () => {
    const id = await livePlan();
    const result = await cycle.runReevaluationCycle(trigger(), id, {
      runBrain: async () => brainResult({ planType: "immediate", executionState: "valid_now" }),
    });
    assert.equal(result.verdict, "revised");
    assert.equal(result.revision?.planType, "immediate");
  });

  it("reports invalidated when the brain says the plan is dead", async () => {
    const id = await livePlan();
    const result = await cycle.runReevaluationCycle(trigger(), id, {
      runBrain: async () =>
        brainResult({ executionState: "invalidated" }),
    });
    // Invalidation comes from the BRAIN through the revision mechanism, never
    // from the tracker deciding a plan is finished.
    assert.equal(result.verdict, "invalidated");
    assert.ok(result.revision);
    const canonical = await repository.getCanonicalRecommendation(userId, id);
    assert.equal(canonical?.status, "invalidated");
    const transitions = await repository.listRecommendationTransitions(userId, id);
    assert.equal(transitions.at(-1)?.toStatus, "invalidated");
  });

  it("stores the evidence snapshot and trace with the revision", async () => {
    const id = await livePlan();
    await cycle.runReevaluationCycle(trigger(), id, {
      runBrain: async () => brainResult({ entry: 3995 }),
    });
    const effective = await revisions.getEffectiveRevision(userId, id);
    assert.ok(effective?.evidenceHash, "every revision must be explainable from its snapshot");
    assert.equal(
      (effective!.decisionTrace as { chosenBecause?: string }).chosenBecause,
      "الطلب صمد.",
    );

    // The two are SEPARATE. evidence_json holds the operator-facing descriptor;
    // the frozen bundle the brain read goes to its own append-only table. They
    // used to be the same field, which wrote hundreds of KB of chart base64
    // into every revision row and left the snapshot table empty for revised
    // plans — so a re-evaluated decision could not be reproduced.
    assert.equal(effective!.evidence.schemaVersion, undefined, "no snapshot in the card slot");
    assert.ok(Array.isArray(effective!.evidence.evidenceDimensions), "the card is the descriptor");

    const { getEvidenceSnapshot } = await import(
      "@/lib/recommendations/canonical/evidenceSnapshots"
    );
    const stored = await getEvidenceSnapshot(userId, id, effective!.revisionNo);
    assert.ok(stored, "a re-evaluated revision must store the bundle it decided on");
    assert.equal(stored!.snapshot.schemaVersion, 1);
    assert.deepEqual(stored!.snapshot.visualSnapshots, []);
    assert.equal(stored!.sourceSurface, "reevaluation");
    // The hash names what is actually stored.
    assert.equal(effective!.evidenceHash, stored!.fingerprint);
  });

  it("ignores wording drift that is not a plan change", async () => {
    const id = await livePlan();
    const result = await cycle.runReevaluationCycle(trigger(), id, {
      runBrain: async () => {
        const answer = brainResult();
        // Different summary and confidence, identical plan.
        return { ...answer, summary: "صياغة مختلفة تماماً", confidence: 88 } as typeof answer;
      },
    });
    assert.equal(result.verdict, "confirmed");
  });
});

describe("the cycle refuses to run where it should not", () => {
  it("rejects a trigger raised against a superseded revision before the brain", async () => {
    const id = await livePlan();
    await revisions.applyRecommendationRevision({
      userId,
      recommendationId: id,
      revision: {
        direction: "buy",
        planType: "conditional",
        executionState: "awaiting_activation",
        entry: 3990,
        stopLoss: 3970,
        targets: [4040],
        reason: "newer plan",
        source: "agent",
        evidence: { schemaVersion: 1 },
      },
    });
    let called = false;
    const result = await cycle.runReevaluationCycle(trigger({ revisionNo: 1 }), id, {
      runBrain: async () => {
        called = true;
        return brainResult();
      },
    });
    assert.equal(result.verdict, "skipped");
    assert.match(result.detail, /stale trigger revision/);
    assert.equal(called, false);
  });

  it("resumes a crashed cycle instead of silently burying it as stale", async () => {
    const id = await livePlan();
    const recommendationId = "rec-cycle-crash-recovery";
    // Simulate the crash: applyRecommendationRevision committed (source
    // "market_update" — exactly what this module's own "changed" branch
    // writes), but recordCycle/manageOpenTradeAfterRevision/announceCycle never
    // ran because the process died in between.
    await revisions.applyRecommendationRevision({
      userId,
      recommendationId: id,
      revision: {
        direction: "buy",
        planType: "conditional",
        executionState: "awaiting_activation",
        entry: 3990,
        stopLoss: 3970,
        targets: [4040],
        reason: "إعادة تقييم (structure_break): تغيّر entry.",
        source: "market_update",
        evidence: { schemaVersion: 1 },
      },
    });

    let called = false;
    // The retry reconstructs the SAME original trigger (revisionNo: 1, the
    // revision in force when it was first raised) — exactly what re-consuming
    // a crashed claim on the next sweep looks like.
    const result = await cycle.runReevaluationCycle(
      trigger({ recommendationId, revisionNo: 1 }),
      id,
      {
        runBrain: async () => {
          called = true;
          return brainResult();
        },
      },
    );

    assert.equal(called, false, "must not re-run the brain for a revision that already landed");
    assert.equal(result.verdict, "revised");
    assert.equal(result.revision?.revisionNo, 2, "must carry the already-applied revision forward");
    assert.match(result.detail, /استُؤنفت دورة إعادة تقييم توقفت/);

    const rows = await db.query<{ outcome: string; revision_no: number }>(
      "SELECT outcome, revision_no FROM recommendation_reevaluations WHERE recommendation_id = ? AND outcome = 'revised'",
      [recommendationId],
    );
    assert.equal(rows.length, 1, "the orphaned transition must be durably recorded exactly once");
    assert.equal(rows[0].revision_no, 1);

    // A second retry of the same now-closed claim must fall through to the
    // ordinary stale-skip — reconciliation must be idempotent, not repeated.
    const second = await cycle.runReevaluationCycle(
      trigger({ recommendationId, revisionNo: 1 }),
      id,
      { runBrain: async () => brainResult() },
    );
    assert.equal(second.verdict, "skipped");
    assert.match(second.detail, /stale trigger revision/);
  });

  it("skips a terminal recommendation", async () => {
    const id = await livePlan();
    const { transitionRecommendation } = repository;
    await transitionRecommendation({
      userId,
      recommendationId: id,
      toStatus: "sl_hit",
      trigger: "stop",
      actor: "tracker",
      source: "test",
      reason: "stop hit",
    });
    const result = await cycle.runReevaluationCycle(trigger(), id, {
      runBrain: async () => brainResult({ entry: 3900 }),
    });
    // A finished plan is history. Re-deciding it would produce a revision the
    // state machine correctly refuses.
    assert.equal(result.verdict, "skipped");
    assert.match(result.detail, /terminal/);
  });

  it("skips when the brain returns an operational blocker instead of a decision", async () => {
    const id = await livePlan();
    const result = await cycle.runReevaluationCycle(trigger(), id, {
      runBrain: async () =>
        ({ decision: "wait", recommendation: undefined } as unknown as import("@/lib/agent/types").AgentFinalResult),
    });
    // Not a verdict about the plan — the previous decision stands until it can
    // actually be re-examined.
    assert.equal(result.verdict, "skipped");
    assert.equal(result.revision, null);
    assert.equal((await revisions.listRevisions(userId, id)).length, 1);
  });

  it("skips when the brain fails entirely", async () => {
    const id = await livePlan();
    const result = await cycle.runReevaluationCycle(trigger(), id, {
      runBrain: async () => null,
    });
    assert.equal(result.verdict, "skipped");
  });

  it("skips when the phase is rolled back", async () => {
    const { clearPlatformConfigCache } = await import("@/lib/platformConfig");
    const id = await livePlan();
    process.env.REEVALUATION_TRIGGERS_V1 = "0";
    clearPlatformConfigCache();
    const result = await cycle.runReevaluationCycle(trigger(), id, {
      runBrain: async () => brainResult({ entry: 3900 }),
    });
    assert.equal(result.verdict, "skipped");
    assert.equal((await revisions.listRevisions(userId, id)).length, 1);
    delete process.env.REEVALUATION_TRIGGERS_V1;
    clearPlatformConfigCache();
  });

  it("does not let two cycles decide the same plan at once", async () => {
    const id = await livePlan();
    let concurrent = 0;
    let maxConcurrent = 0;
    const slowBrain = async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 40));
      concurrent -= 1;
      return brainResult({ entry: 3990 });
    };
    const [a, b] = await Promise.all([
      cycle.runReevaluationCycle(trigger(), id, { runBrain: slowBrain }),
      cycle.runReevaluationCycle(trigger({ reason: "spread_widened" }), id, {
        runBrain: slowBrain,
      }),
    ]);
    assert.equal(maxConcurrent, 1, "the lock must serialize cycles on one plan");
    // One decided; the other was skipped as busy or confirmed against the new
    // levels. Either way the plan was never decided twice at once.
    const verdicts = [a.verdict, b.verdict];
    assert.ok(verdicts.includes("revised") || verdicts.includes("confirmed"));
    assert.ok(
      verdicts.filter((v) => v === "revised").length <= 1,
      "two concurrent revisions from one condition",
    );
  });

  it("keeps a claimed request pending while busy and consumes it later", async () => {
    const id = await livePlan();
    const requested = trigger({
      recommendationId: String(id),
      reason: "user_request",
      source: "user",
      idempotencyKey: `user-retry-${id}`,
    });
    assert.equal(
      (await reevaluationTriggers.admitTriggers([requested])).admitted.length,
      1,
    );

    const held = await locks.acquireLock(`reevaluation:${id}`, 15_000);
    assert.ok(held);
    try {
      const busy = await cycle.consumePendingReevaluationTriggers(
        { userId },
        { runBrain: async () => brainResult() },
      );
      assert.equal(busy[0]?.verdict, "skipped");
      assert.equal(busy[0]?.retryable, true);
      const rows = await db.query<{ completed_at: number | null }>(
        `SELECT completed_at FROM recommendation_reevaluations
          WHERE recommendation_id = ? AND outcome = 'cycle_requested'`,
        [String(id)],
      );
      assert.equal(rows[0]?.completed_at, null);
    } finally {
      await locks.releaseLock(held!);
    }

    const retried = await cycle.consumePendingReevaluationTriggers(
      { userId },
      { runBrain: async () => brainResult(), silentNotifications: true },
    );
    assert.equal(retried[0]?.verdict, "confirmed");
    const pending = await db.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM recommendation_reevaluations
        WHERE recommendation_id = ? AND outcome = 'cycle_requested'
          AND completed_at IS NULL`,
      [String(id)],
    );
    assert.equal(Number(pending[0]!.count), 0);
  });
});

describe("the ordering is structural, not just intended", () => {
  it("reaches the brain through the same entry point a chat analysis uses", () => {
    const cycleSource = readFileSync(
      resolve(process.cwd(), "src/lib/recommendations/reevaluationCycle.ts"),
      "utf8",
    );
    // A second, cheaper "re-check" path would be a second brain with its own
    // habits, and the two would drift apart.
    assert.ok(
      /runUnifiedChartAgent\s*\(/.test(cycleSource),
      "the cycle must call the unified brain entry point",
    );
    assert.ok(
      !/runFinalDecisionSynthesizer\s*\(/.test(cycleSource),
      "the cycle must not reach past the orchestrator into the synthesizer, which would skip the evidence bundle",
    );
  });

  it("keeps the tracker out of the cycle entirely", () => {
    const tracker = readFileSync(
      resolve(process.cwd(), "src/lib/recommendations/recommendationTracker.ts"),
      "utf8",
    );
    assert.ok(!/applyRecommendationRevision\s*\(/.test(tracker));
    assert.ok(!/runReevaluationCycle\s*\(/.test(tracker));
    assert.ok(
      /detectReevaluationTriggers\s*\(/.test(tracker),
      "the tracker still raises triggers — it just does not run them",
    );
  });
});
