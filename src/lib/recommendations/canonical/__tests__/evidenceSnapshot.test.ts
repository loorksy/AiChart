/**
 * High #2 (and Medium #15): the frozen evidence snapshot.
 *
 * Revision 1 used to store the graded evidence CARD while its `evidence_hash`
 * claimed to fingerprint "the evidence bundle this revision was decided on".
 * Two different objects — so nothing could reproduce a decision, and the parity
 * log hashed a third thing again.
 *
 * These pin: the hash describes what is actually stored, the snapshot is bound
 * to one user + recommendation + revision, revision 1 is immutable when
 * revision 2 lands, and the browser projection carries no imagery.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import {
  canonicalizeEvidence,
  evidenceSnapshotFingerprint,
} from "@/lib/recommendations/canonical/evidenceSnapshots";
import {
  containsRawImagery,
  toPublicEvidenceProjection,
} from "@/lib/recommendations/publicEvidenceProjection";

const dir = mkdtempSync(join(tmpdir(), "aichart-evidence-"));
process.env.DB_PATH = join(dir, "evidence.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "evidence-test-secret";
delete process.env.DATABASE_URL;

/** A snapshot shaped like the real one: model context + chart images. */
function snapshotFixture(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    modelContext: {
      evidenceLevels: [{ price: 4000, source: "swing_high" }],
      executionCost: { observed_spread: 0.22 },
      tradeCandidates: [{ id: "tc-0", rr: 2.1 }],
    },
    visualSnapshots: [
      { timeframe: "1h", imageBase64: "A".repeat(2048) },
    ],
    locale: "ar",
    ...overrides,
  };
}

let owner = 0;
let other = 0;
let counter = 0;
// Unique per run: the canonical suites can share a process, so a fixed
// address collides with a previous file's users table.
const tag = Math.floor(performance.now() * 1000);

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`evidence-owner-${tag}@example.com`, "x", "user", "active"],
  );
  // Lifecycle tests model paying subscribers — the 3-recommendation trial
  // cap is covered by the subscription suite, not here.
  await db.execute(
    "INSERT INTO user_entitlements (user_id, plan_status) VALUES (?, 'active')",
    [owner],
  );
  other = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`evidence-other-${tag}@example.com`, "x", "user", "active"],
  );
  // Lifecycle tests model paying subscribers — the 3-recommendation trial
  // cap is covered by the subscription suite, not here.
  await db.execute(
    "INSERT INTO user_entitlements (user_id, plan_status) VALUES (?, 'active')",
    [other],
  );
});

async function newRecommendation(snapshot: Record<string, unknown> | null) {
  const lifecycle = await import("@/lib/recommendations/canonical");
  const { seedPassedGateChain } = await import(
    "@/lib/recommendations/__tests__/fixtures/completePlan"
  );
  counter += 1;
  const analysisId = `evidence-${tag}-${counter}`;
  await seedPassedGateChain(owner, analysisId, "XAUUSD");
  return lifecycle.createCanonicalRecommendation({
    userId: owner,
    analysisId,
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "1h",
    direction: "buy",
    entry: 4000,
    stopLoss: 3980,
    targets: [4040],
    risk: {},
    confidence: 70,
    strategyId: "unspecified",
    strategyVersion: "1",
    source: "test",
    engineVersion: "evidence-test",
    planType: "immediate",
    executionState: "valid_now",
    initialRevision: {
      invalidationRule: "إغلاق شمعة تحت 3980 يلغي الفكرة",
      alternativeScenario: "كسر 3980 يفتح مسارًا هابطًا",
      validityCandles: 12,
      evidence: {
        evidenceDimensions: [
          { key: "structure", grade: "strong", detail: "بنية صاعدة فوق 3980" },
        ],
      },
      evidenceSnapshot: snapshot,
      evidenceSourceSurface: "platform",
    },
  });
}

describe("canonicalization", () => {
  it("is stable under key order — equal snapshots hash equally", () => {
    const a = { schemaVersion: 1, b: 2, a: { y: 1, x: 2 } };
    const b = { a: { x: 2, y: 1 }, schemaVersion: 1, b: 2 };
    assert.equal(canonicalizeEvidence(a), canonicalizeEvidence(b));
    assert.equal(evidenceSnapshotFingerprint(a), evidenceSnapshotFingerprint(b));
  });

  it("preserves array order — it carries meaning", () => {
    assert.notEqual(
      evidenceSnapshotFingerprint({ tf: ["1h", "4h"] }),
      evidenceSnapshotFingerprint({ tf: ["4h", "1h"] }),
    );
  });

  it("distinguishes genuinely different evidence", () => {
    assert.notEqual(
      evidenceSnapshotFingerprint(snapshotFixture()),
      evidenceSnapshotFingerprint(snapshotFixture({ locale: "en" })),
    );
  });
});

describe("the stored snapshot is what the fingerprint describes", () => {
  it("stores the snapshot on revision 1 and hashes THAT object", async () => {
    const snapshot = snapshotFixture();
    const created = await newRecommendation(snapshot);
    const { getEvidenceSnapshot, verifyEvidenceSnapshot } = await import(
      "@/lib/recommendations/canonical/evidenceSnapshots"
    );
    const { getEffectiveRevision } = await import(
      "@/lib/recommendations/canonical/revisions"
    );

    const record = await getEvidenceSnapshot(owner, created.recommendationId, 1);
    assert.ok(record, "revision 1 must have a snapshot");
    // The whole bundle survived — model context and numeric levels included.
    assert.deepEqual(record!.snapshot.modelContext, snapshot.modelContext);
    assert.equal(record!.sourceSurface, "platform");

    // The revision's hash IS the snapshot's fingerprint — one object, one hash.
    const revision = await getEffectiveRevision(owner, created.recommendationId);
    assert.equal(revision?.evidenceHash, record!.fingerprint);
    assert.equal(record!.fingerprint, evidenceSnapshotFingerprint(snapshot));

    // Re-derived from the stored bytes, it still matches.
    const verified = await verifyEvidenceSnapshot(owner, created.recommendationId, 1);
    assert.equal(verified.ok, true);
    assert.equal(verified.stored, verified.recomputed);
  });

  it("no longer hashes the graded card", async () => {
    const snapshot = snapshotFixture();
    const created = await newRecommendation(snapshot);
    const { getEffectiveRevision, evidenceFingerprint } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    const revision = await getEffectiveRevision(owner, created.recommendationId);
    // The old behaviour, stated as the thing that must NOT be true.
    assert.notEqual(revision?.evidenceHash, evidenceFingerprint(revision?.evidence));
  });

  it("a revision with no snapshot keeps a null snapshot, not a fabricated one", async () => {
    const created = await newRecommendation(null);
    const { getEvidenceSnapshot } = await import(
      "@/lib/recommendations/canonical/evidenceSnapshots"
    );
    assert.equal(await getEvidenceSnapshot(owner, created.recommendationId, 1), null);
  });
});

describe("user scoping", () => {
  it("another operator cannot read the snapshot by guessing the id", async () => {
    const created = await newRecommendation(snapshotFixture());
    const { getEvidenceSnapshot } = await import(
      "@/lib/recommendations/canonical/evidenceSnapshots"
    );
    assert.ok(await getEvidenceSnapshot(owner, created.recommendationId, 1));
    assert.equal(await getEvidenceSnapshot(other, created.recommendationId, 1), null);
  });
});

describe("revision 2 does not disturb revision 1", () => {
  it("stores its own snapshot and leaves the first untouched", async () => {
    const first = snapshotFixture();
    const created = await newRecommendation(first);
    const { getEvidenceSnapshot } = await import(
      "@/lib/recommendations/canonical/evidenceSnapshots"
    );
    const { applyRecommendationRevision, listRevisions } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    const before1 = await getEvidenceSnapshot(owner, created.recommendationId, 1);

    const second = snapshotFixture({ locale: "en" });
    await applyRecommendationRevision({
      userId: owner,
      recommendationId: created.recommendationId,
      revision: {
        direction: "buy",
        planType: "immediate",
        executionState: "valid_now",
        entry: 4005,
        stopLoss: 3985,
        targets: [4045],
        invalidationRule: "إغلاق تحت 3985 يلغي الفكرة",
        alternativeScenario: "كسر 3985 يقلب المشهد",
        validityCandles: 12,
        reason: "research moved the levels",
        source: "deep_research",
        evidence: { evidenceDimensions: [] },
        evidenceSnapshot: second,
        evidenceSourceSurface: "research",
      },
    });

    const snap1 = await getEvidenceSnapshot(owner, created.recommendationId, 1);
    const snap2 = await getEvidenceSnapshot(owner, created.recommendationId, 2);
    assert.deepEqual(snap1, before1, "revision 1's snapshot must be untouched");
    assert.ok(snap2);
    assert.notEqual(snap2!.fingerprint, snap1!.fingerprint);
    assert.equal(snap2!.sourceSurface, "research");

    // Each revision's hash names its own snapshot.
    const history = await listRevisions(owner, created.recommendationId);
    for (const revision of history) {
      const record = await getEvidenceSnapshot(
        owner,
        created.recommendationId,
        revision.revisionNo,
      );
      if (record) assert.equal(revision.evidenceHash, record.fingerprint);
    }
  });

  it("a stored snapshot cannot be edited underneath the plan", async () => {
    const db = await import("@/lib/db");
    const created = await newRecommendation(snapshotFixture());
    await assert.rejects(
      db.execute(
        "UPDATE recommendation_evidence_snapshots SET snapshot_json = ? WHERE recommendation_id = ? AND revision_no = 1",
        ["{}", created.recommendationId],
      ),
      /append-only|immutable|TRIGGER/i,
    );
  });
});

describe("the public projection (Medium #15)", () => {
  it("carries the card and the snapshot's identity, never its contents", () => {
    const projection = toPublicEvidenceProjection({
      descriptor: {
        evidenceDimensions: [
          { key: "structure", grade: "strong", detail: "بنية صاعدة", value: 3 },
        ],
      },
      fingerprint: "abc123",
      revisionNo: 1,
      capturedAt: 1_700_000_000_000,
      sourceSurface: "platform",
      snapshotStored: true,
    });
    assert.equal(projection.fingerprint, "abc123");
    assert.equal(projection.snapshotStored, true);
    assert.equal(projection.evidenceDimensions.length, 1);
    assert.equal(projection.evidenceDimensions[0]!.key, "structure");
    assert.equal(containsRawImagery(projection), false);
  });

  it("drops imagery and model context even when handed a whole snapshot", () => {
    // The allow-list shape is the point: feeding it the internal bundle yields
    // nothing but the (absent) card.
    const projection = toPublicEvidenceProjection({
      descriptor: snapshotFixture() as unknown as Record<string, unknown>,
      fingerprint: "abc123",
    });
    assert.deepEqual(projection.evidenceDimensions, []);
    assert.equal(containsRawImagery(projection), false);
    assert.equal(JSON.stringify(projection).includes("AAAA"), false);
  });

  it("drops malformed dimensions rather than passing them through", () => {
    const projection = toPublicEvidenceProjection({
      descriptor: {
        evidenceDimensions: [
          { key: "ok", grade: "strong", detail: "fine" },
          { key: "bad", grade: "made_up" },
          { grade: "strong" },
          "not an object",
        ],
      },
    });
    assert.equal(projection.evidenceDimensions.length, 1);
    assert.equal(projection.evidenceDimensions[0]!.key, "ok");
  });

  it("containsRawImagery catches a base64 payload at depth", () => {
    assert.equal(containsRawImagery({ a: { b: { imageBase64: "x" } } }), true);
    assert.equal(containsRawImagery({ a: { b: { c: "B".repeat(1024) } } }), true);
    assert.equal(containsRawImagery({ a: { b: { c: "short" } } }), false);
  });
});
