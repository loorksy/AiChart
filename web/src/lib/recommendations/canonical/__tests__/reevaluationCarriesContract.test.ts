/**
 * Found by a production audit, not by a test: the fixes held at CREATION and
 * were undone by the REVISION path.
 *
 * Every re-evaluation revision in production (`source=market_update`) had
 * `activation_rule_json` NULL — so the effective revision of every revised
 * conditional plan carried no machine-checked trigger, and the tracker fell
 * back to the bare entry touch that the structured rule exists to prevent.
 * The same revision wrote the frozen snapshot into the operator-facing CARD
 * column: 232KB of chart base64 per revision, no row in the snapshot table,
 * and an Evidence Card that rendered nothing because the dimensions were not
 * where the reader looks.
 *
 * These assert the revision path carries the same contract the creation path
 * does — measured against a real database.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import type { ActivationRule } from "@/lib/recommendations/activationRule";

const dir = mkdtempSync(join(tmpdir(), "aichart-reeval-contract-"));
process.env.DB_PATH = join(dir, "reeval.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "reeval-contract-secret";
delete process.env.DATABASE_URL;

const tag = Math.floor(performance.now() * 1000);
let owner = 0;

const RULE: ActivationRule = {
  kind: "candle_close_above",
  level: 4000,
  timeframe: "15m",
};

/** A snapshot shaped like the real one — model context plus chart imagery. */
function snapshotFixture() {
  return {
    schemaVersion: 1,
    modelContext: { evidenceLevels: [{ price: 4000, source: "swing" }] },
    visualSnapshots: [{ timeframe: "15m", imageBase64: "A".repeat(4096) }],
  };
}

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`reeval-contract-${tag}@example.com`, "x", "user", "active"],
  );
});

async function conditionalPlan() {
  const lifecycle = await import("@/lib/recommendations/canonical");
  return lifecycle.createCanonicalRecommendation({
    userId: owner,
    analysisId: `reeval-${tag}-${Math.random()}`,
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "15m",
    direction: "buy",
    entry: 3996,
    stopLoss: 3990,
    targets: [4030],
    risk: {},
    confidence: 70,
    strategyId: "unspecified",
    strategyVersion: "1",
    source: "test",
    engineVersion: "reeval-contract",
    planType: "conditional",
    executionState: "awaiting_activation",
    initialRevision: {
      activationCondition: "إغلاق شمعة 15m فوق 4000 يفعّل الخطة.",
      activationRule: RULE,
      invalidationRule: "إغلاق تحت 3990 يلغي الفكرة.",
      alternativeScenario: "كسر 3990 يقلب المشهد هبوطًا.",
      validityCandles: 12,
      evidence: { evidenceDimensions: [{ key: "structure", grade: "strong", detail: "بنية صاعدة" }] },
      evidenceSnapshot: snapshotFixture(),
      evidenceSourceSurface: "platform",
    },
  });
}

/** The revision a re-evaluation writes, in the corrected shape. */
async function reviseLikeReevaluation(
  recommendationId: number,
  rule: ActivationRule | null,
) {
  const revisions = await import("@/lib/recommendations/canonical/revisions");
  return revisions.applyRecommendationRevision({
    userId: owner,
    recommendationId,
    revision: {
      direction: "buy",
      planType: "conditional",
      executionState: "awaiting_activation",
      entry: 3998,
      stopLoss: 3991,
      targets: [4035],
      activationCondition: "إغلاق شمعة 15m فوق 4005 بعد التشديد.",
      activationRule: rule,
      invalidationRule: "إغلاق تحت 3991 يلغي الفكرة.",
      alternativeScenario: "كسر 3991 يقلب المشهد هبوطًا.",
      validityCandles: 12,
      reason: "إعادة تقييم",
      source: "market_update",
      evidence: { evidenceDimensions: [{ key: "structure", grade: "moderate", detail: "أضعف" }] },
      evidenceSnapshot: snapshotFixture(),
      evidenceSourceSurface: "reevaluation",
    },
  });
}

describe("a revised conditional plan keeps its machine-checked trigger", () => {
  it("carries the activation rule onto the new effective revision", async () => {
    const revisions = await import("@/lib/recommendations/canonical/revisions");
    const created = await conditionalPlan();
    const stricter: ActivationRule = {
      kind: "candle_close_above",
      level: 4005,
      timeframe: "15m",
      closes: 2,
    };
    await reviseLikeReevaluation(created.recommendationId, stricter);

    const effective = await revisions.getEffectiveRevision(
      owner,
      created.recommendationId,
    );
    assert.equal(effective?.revisionNo, 2);
    // The production defect, stated: this was NULL on every revised plan.
    assert.ok(effective?.activationRule, "the revision must carry a rule");
    assert.deepEqual(effective?.activationRule, stricter);
  });

  it("the tracker therefore still refuses a bare touch after revision", async () => {
    const { evaluateRecommendation } = await import(
      "@/lib/recommendations/recommendationStatus"
    );
    const revisions = await import("@/lib/recommendations/canonical/revisions");
    const created = await conditionalPlan();
    await reviseLikeReevaluation(created.recommendationId, RULE);
    const effective = await revisions.getEffectiveRevision(
      owner,
      created.recommendationId,
    );

    const T = Date.UTC(2026, 0, 1, 12, 0, 0);
    const result = evaluateRecommendation({
      recommendation: {
        direction: "buy",
        entryType: "limit",
        entry: 3998,
        stopLoss: 3991,
        targets: [4035],
        status: "pending_entry",
        outcome: "pending",
        createdAt: T,
        createdCandleTime: T,
        expiresAt: T + 10 * 3_600_000,
        activationRule: effective?.activationRule ?? undefined,
      },
      // A wick that reaches the entry but closes below the rule's level.
      candles: [{ time: T + 60_000, open: 3999, high: 4001, low: 3997, close: 3998.5 }],
      now: T + 120_000,
    });
    assert.equal(result.triggered, false, "a revised plan must not fill on a touch");
  });
});

describe("a revised plan stores its snapshot where snapshots live", () => {
  it("writes a snapshot row and keeps the card slot small", async () => {
    const snapshots = await import(
      "@/lib/recommendations/canonical/evidenceSnapshots"
    );
    const db = await import("@/lib/db");
    const created = await conditionalPlan();
    await reviseLikeReevaluation(created.recommendationId, RULE);

    const record = await snapshots.getEvidenceSnapshot(
      owner,
      created.recommendationId,
      2,
    );
    assert.ok(record, "revision 2 must have its own snapshot row");
    assert.equal(record!.sourceSurface, "reevaluation");

    // The card column holds the descriptor, not 232KB of chart base64.
    const row = await db.queryOne<{ evidence_json: string }>(
      "SELECT evidence_json FROM recommendation_revisions WHERE recommendation_id = ? AND revision_no = 2",
      [created.recommendationId],
    );
    assert.ok(row);
    assert.ok(
      row!.evidence_json.length < 4096,
      `card slot must stay small, was ${row!.evidence_json.length} bytes`,
    );
    assert.equal(row!.evidence_json.includes("imageBase64"), false);
  });

  it("the Evidence Card still has dimensions to render after a revision", async () => {
    const revisions = await import("@/lib/recommendations/canonical/revisions");
    const { toPublicEvidenceProjection } = await import(
      "@/lib/recommendations/publicEvidenceProjection"
    );
    const created = await conditionalPlan();
    await reviseLikeReevaluation(created.recommendationId, RULE);
    const effective = await revisions.getEffectiveRevision(
      owner,
      created.recommendationId,
    );

    const projection = toPublicEvidenceProjection({
      descriptor: effective?.evidence,
      fingerprint: effective?.evidenceHash,
      revisionNo: effective?.revisionNo,
    });
    // Production showed dims=0 for every revised plan: an empty card.
    assert.ok(
      projection.evidenceDimensions.length > 0,
      "a revised plan must still render its evidence card",
    );
  });

  it("the revision hash describes the stored snapshot, not the card", async () => {
    const revisions = await import("@/lib/recommendations/canonical/revisions");
    const snapshots = await import(
      "@/lib/recommendations/canonical/evidenceSnapshots"
    );
    const created = await conditionalPlan();
    await reviseLikeReevaluation(created.recommendationId, RULE);
    const effective = await revisions.getEffectiveRevision(
      owner,
      created.recommendationId,
    );
    const verified = await snapshots.verifyEvidenceSnapshot(
      owner,
      created.recommendationId,
      2,
    );
    assert.equal(verified.ok, true);
    assert.equal(effective?.evidenceHash, verified.stored);
  });
});
