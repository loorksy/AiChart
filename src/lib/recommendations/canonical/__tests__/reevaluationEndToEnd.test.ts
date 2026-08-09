import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-reeval-e2e-"));
process.env.DB_PATH = join(dir, "reeval-e2e.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "reeval-e2e-secret";
process.env.VISION_DECISION_V1 = "0";
process.env.FEATURE_AGENT_SKILLS = "0";
process.env.CASE_MEMORY_V1 = "0";
process.env.AGENT_RUN_TRACE_V1 = "0";
process.env.AUTO_EXECUTION_STAGE = "off";
delete process.env.DATABASE_URL;
delete process.env.TELEGRAM_BOT_TOKEN;

let db: typeof import("@/lib/db");
let repository: typeof import("@/lib/recommendations/canonical/repository");
let revisions: typeof import("@/lib/recommendations/canonical/revisions");
let triggers: typeof import("@/lib/recommendations/reevaluationTriggers");
let cycles: typeof import("@/lib/recommendations/reevaluationCycle");
let candles: typeof import("@/lib/candles/candleRepository");
let store: typeof import("@/lib/store");
let execution: typeof import("@/lib/execution");
let userId = 0;

/**
 * skipWeekends is off for the DAILY series: a weekday-only daily seed reads as
 * roughly 28% of calendar days missing, so the coverage check can classify the
 * fixture as a data outage and return an operational blocker instead of a
 * decision — and whether it did depended on the wall clock when the suite ran.
 */
function weekdayBars(
  count: number,
  intervalMs: number,
  endAt: number,
  start: number,
  skipWeekends = true,
) {
  const times: number[] = [];
  let cursor = endAt;
  while (times.length < count) {
    const day = new Date(cursor).getUTCDay();
    // Keep the fixture tail recent so the source-lock sync guard can accept the
    // warehouse when no live broker feed exists; older bars still skip weekends.
    if (!skipWeekends || times.length === 0 || (day !== 0 && day !== 6)) {
      times.push(cursor);
    }
    cursor -= intervalMs;
  }
  return times.reverse().map((time, index) => {
    const center =
      start +
      index * 0.000015 +
      Math.sin(index / 4) * 0.00035;
    const open = center - 0.00004;
    const close = center + 0.00004;
    return {
      time,
      open,
      high: center + 0.0002,
      low: center - 0.0002,
      close,
      volume: 100 + index,
      complete: true,
    };
  });
}

function modelAnswer(user: string): string {
  const context = JSON.parse(user) as {
    currentPrice: number;
    tradeCandidates?: Array<{
      id: string;
      action: "buy" | "sell";
    }>;
    evidenceLevels?: Array<{ price: number }>;
  };
  const candidate = context.tradeCandidates?.[0];
  let direction: "buy" | "sell" = candidate?.action ?? "buy";
  let selectedTradeCandidateId: string | null = candidate?.id ?? null;
  let proposedLevels:
    | {
        preferredEntry: number;
        stopLoss: number;
        targets: number[];
      }
    | null = null;

  if (!candidate) {
    const prices = (context.evidenceLevels ?? [])
      .map((level) => level.price)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const below = prices.filter((price) => price < context.currentPrice);
    const above = prices.filter((price) => price > context.currentPrice);
    if (below.length >= 2 && above.length) {
      direction = "buy";
      proposedLevels = {
        preferredEntry: below.at(-1)!,
        stopLoss: below[0]!,
        targets: [above.at(-1)!],
      };
    } else if (above.length >= 2 && below.length) {
      direction = "sell";
      proposedLevels = {
        preferredEntry: above[0]!,
        stopLoss: above.at(-1)!,
        targets: [below[0]!],
      };
    } else {
      throw new Error("fixture did not produce grounded levels");
    }
    selectedTradeCandidateId = null;
  }

  return JSON.stringify({
    direction,
    planType: "conditional",
    selectedTradeCandidateId,
    proposedLevels,
    timeframeRoles: { lead: "15m", context: "1h", timing: "15m" },
    activationCondition: "Wait for a confirming close at the selected entry.",
    // The synthesizer schema now refuses a conditional plan whose condition
    // has no machine-checkable rule — the exact defect that let plans fill on
    // a bare touch. The scripted model must honour the same contract.
    activationRule: {
      kind: direction === "buy" ? "candle_close_above" : "candle_close_below",
      level: proposedLevels?.preferredEntry ?? context.currentPrice,
      timeframe: "15m",
    },
    invalidationRule: "A close beyond the selected stop invalidates the plan.",
    alternativeScenario: "Switch only after the opposite structure break.",
    validityCandles: 7,
    confidence: 0.64,
    summary:
      "EURUSD was re-evaluated from a fresh complete evidence bundle after the trigger.",
    keyReasons: ["Fresh structure and cost evidence were rebuilt."],
    riskWarnings: ["The plan remains conditional."],
    publicReasoningSummary: ["The selected levels are grounded in the bundle."],
    decisionTrace: {
      hypotheses: [
        {
          scenario: "Continuation from the selected level.",
          supporting: ["Structure and a grounded candidate."],
          opposing: ["Execution cost can still widen."],
        },
      ],
      chosenBecause: "It has the strongest grounded structure.",
      planTypeBecause: "Price must confirm before entry.",
    },
    drawingAdvice: { shouldDraw: false, reason: "No drawing is needed in this test." },
    selectedCandidateIds: selectedTradeCandidateId
      ? [selectedTradeCandidateId]
      : [],
    requestExtraTimeframe: null,
  });
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  repository = await import("@/lib/recommendations/canonical/repository");
  revisions = await import("@/lib/recommendations/canonical/revisions");
  triggers = await import("@/lib/recommendations/reevaluationTriggers");
  cycles = await import("@/lib/recommendations/reevaluationCycle");
  candles = await import("@/lib/candles/candleRepository");
  store = await import("@/lib/store");
  execution = await import("@/lib/execution");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["reeval-e2e@example.com", "x", "user", "active"],
  );
  const friday = Date.now();
  await candles.upsertCandles(
    "EURUSD",
    "15m",
    weekdayBars(650, 15 * 60_000, friday, 1.08),
  );
  await candles.upsertCandles(
    "EURUSD",
    "1h",
    weekdayBars(260, 60 * 60_000, friday, 1.075),
  );
  await candles.upsertCandles(
    "EURUSD",
    "1d",
    weekdayBars(130, 24 * 60 * 60_000, friday, 1.06, false),
  );
});

describe("automatic trigger consumption through the real unified brain", () => {
  it("claims once, rebuilds full evidence, revises, records, and notifies", async () => {
    const recommendation = await repository.createCanonicalRecommendation({
      userId,
      symbol: "EURUSD",
      market: "forex",
      timeframe: "15m",
      direction: "buy",
      entry: 1.07,
      stopLoss: 1.06,
      targets: [1.09],
      planType: "immediate",
      executionState: "valid_now",
      status: "active",
      source: "test",
      engineVersion: "reeval-e2e",
      initialRevision: {
        validityCandles: 12,
        alternativeScenario: "Old alternative.",
        invalidationRule: "Old invalidation.",
        evidence: {
          schemaVersion: 1,
          modelContext: {
            executionCost: { expected_spread: 1, observed_spread: 1 },
          },
          visualSnapshots: [],
        },
      },
    });
    const reference = String(recommendation.recommendationId);
    const detected = triggers.detectReevaluationTriggers({
      recommendation: {
        id: reference,
        userId,
        symbol: "EURUSD",
        direction: "buy",
        entry: 1.07,
        stopLoss: 1.06,
        revisionNo: 1,
      },
      spread: { now: 2.5, plannedFor: 1 },
      now: Date.now(),
    });
    assert.equal(detected[0]?.reason, "spread_widened");

    const [claimA, claimB] = await Promise.all([
      triggers.admitTriggers(detected),
      triggers.admitTriggers(detected),
    ]);
    const admitted = [...claimA.admitted, ...claimB.admitted];
    assert.equal(admitted.length, 1, "overlapping sweeps must buy one brain call");
    const waitingIntent = await store.createIntent(userId, {
      recommendation_id: recommendation.recommendationId,
      recommendation_revision_no: 1,
      authorization_source: "user_approved",
      symbol: "EURUSD",
      side: "buy",
      notional: 100,
      market: "forex",
      broker: "metaapi",
      entry: 1.07,
      stop_loss: 1.06,
      take_profit: 1.09,
    });

    let modelCalls = 0;
    const beforeCount = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM recommendations WHERE user_id = ?",
      [userId],
    );
    const consumed = await cycles.consumePendingReevaluationTriggers(
      { userId },
      {
        synthesizerDeps: {
          configured: true,
          callModel: async (_system, user) => {
            modelCalls += 1;
            return modelAnswer(user);
          },
        },
        silentNotifications: true,
      },
    );
    const result = consumed.find(
      (item) => item.recommendationId === reference,
    )!;

    assert.ok(result, "the durable DB claim was not consumed");
    assert.equal(modelCalls, 1, result.detail);
    assert.ok(
      result.verdict === "revised" || result.verdict === "invalidated",
      result.detail,
    );
    assert.equal(result.revision?.revisionNo, 2);
    assert.equal(result.evidenceHash, result.revision?.evidenceHash);
    // The card slot carries the descriptor now; the frozen bundle lives in the
    // snapshot table, named by the hash asserted equal above.
    assert.ok(Array.isArray(result.revision?.evidence.evidenceDimensions));
    const { getEvidenceSnapshot } = await import(
      "@/lib/recommendations/canonical/evidenceSnapshots"
    );
    const storedSnapshot = await getEvidenceSnapshot(
      userId,
      result.revision!.recommendationId,
      result.revision!.revisionNo,
    );
    assert.ok(storedSnapshot, "the re-evaluated bundle is stored whole");
    assert.equal(storedSnapshot!.snapshot.schemaVersion, 1);
    assert.equal(storedSnapshot!.fingerprint, result.evidenceHash);
    // modelContext lives in the SNAPSHOT now, not in the card slot — that
    // relocation is the fix this suite exists to pin.
    assert.ok(storedSnapshot!.snapshot.modelContext);
    assert.ok(result.revision?.decisionTrace.chosenBecause);

    const afterCount = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM recommendations WHERE user_id = ?",
      [userId],
    );
    assert.equal(
      Number(afterCount[0]!.count),
      Number(beforeCount[0]!.count),
      "reevaluation mode must not create a second recommendation",
    );

    const rows = await db.query<{
      outcome: string;
      evidence_hash: string | null;
      trigger_payload_json: string;
      evidence_json: string;
      decision_trace_json: string;
    }>(
      `SELECT outcome, evidence_hash, trigger_payload_json, evidence_json,
              decision_trace_json
         FROM recommendation_reevaluations
        WHERE recommendation_id = ? ORDER BY id`,
      [reference],
    );
    assert.deepEqual(
      rows.map((row) => row.outcome),
      ["cycle_requested", result.verdict],
    );
    const verdictRow = rows.at(-1)!;
    assert.equal(verdictRow.evidence_hash, result.evidenceHash);
    assert.equal(JSON.parse(verdictRow.trigger_payload_json).reason, "spread_widened");
    assert.ok(JSON.parse(verdictRow.evidence_json).modelContext);
    assert.ok(JSON.parse(verdictRow.decision_trace_json).chosenBecause);
    const pendingClaims = await db.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM recommendation_reevaluations
        WHERE recommendation_id = ? AND outcome = 'cycle_requested'
          AND completed_at IS NULL`,
      [reference],
    );
    assert.equal(
      Number(pendingClaims[0]!.count),
      0,
      "a terminal verdict must atomically mark its durable claim complete",
    );

    const current = await revisions.getEffectiveRevision(
      userId,
      recommendation.recommendationId,
    );
    assert.equal(current?.revisionNo, 2);
    // Open the upstream stage gate and leave a real server-recorded approval so
    // the refusal proven here is the stale-revision CAS, not an earlier gate.
    await db.execute(
      "UPDATE trade_intents SET approved_at = ?, approved_by_user_id = ? WHERE id = ?",
      [Date.now(), userId, waitingIntent.id],
    );
    process.env.AUTO_EXECUTION_STAGE = "live";
    let staleExecution: Awaited<ReturnType<typeof execution.executeIntent>>;
    try {
      staleExecution = await execution.executeIntent(
        userId,
        waitingIntent.id,
        { explicitApproval: true },
      );
    } finally {
      process.env.AUTO_EXECUTION_STAGE = "off";
    }
    assert.equal(staleExecution.ok, false);
    assert.equal(staleExecution.errorCode, "stale_revision");
    const notices = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM alert_dedupe WHERE user_id = ?",
      [userId],
    );
    assert.ok(Number(notices[0]!.count) >= 1);
  });
});
