/**
 * Historical Candidate-backed E2E through store adapters + mapper + stats.
 * Uses an isolated SQLite DB (same pattern as recommendationStore tests).
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mapHistoricalRecommendationContext } from "@/lib/agent/modelFirst/modelPlanPersistence";
import { computeRecommendationStats } from "@/lib/recommendations/recommendationStats";

test("historical Candidate-backed record survives store → list → mapper → stats", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-hist-cand-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`hist-owner-${Date.now()}@example.invalid`, "x", "user", "active"],
  );
  const attacker = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`hist-attacker-${Date.now()}@example.invalid`, "x", "user", "active"],
  );

  const store = await import("@/lib/recommendations/recommendationStore");
  const suffix = `hist-cand-${Date.now()}`;
  const now = Date.now();

  const legacyRisk = {
    poi: { score: 0.81, type: "demand", low: 1.0845, high: 1.085 },
    selectedTradeCandidateId: "cand_HIST_SANITIZED_E2E_001",
    selectedCandidate: {
      id: "cand_HIST_SANITIZED_E2E_001",
      side: "buy",
      entry: 1.08501,
      stop: 1.08351,
      targets: [1.08651, 1.08751],
    },
    invalidationLevel: 1.08351,
    note: "sanitized PR66 historical fixture — no real customer PII",
  };

  const created = await store.createTrackedRecommendation({
    id: suffix,
    userId: owner,
    chatId: `chat-${suffix}`,
    analysisId: `analysis-${suffix}`,
    symbol: "EURUSD",
    interval: "5m",
    direction: "buy",
    entryType: "limit",
    entry: 1.08501,
    stopLoss: 1.08351,
    targets: [1.08651, 1.08751],
    invalidationLevel: 1.08351,
    status: "sl_hit",
    outcome: "loss",
    setupType: "legacy-candidate-compat",
    rr: 1.5,
    createdAt: now - 86_400_000,
    createdCandleTime: now - 86_400_000,
    expiresAt: now + 86_400_000,
    priceAtCreation: 1.0851,
    confidence: 74,
    riskExtras: legacyRisk,
    contextJson: undefined,
  });

  assert.ok(created.id);
  assert.equal(created.direction, "buy");
  assert.equal(created.entry, 1.08501);
  assert.equal(created.stopLoss, 1.08351);

  const fetched = await store.getTrackedRecommendation(owner, created.id);
  assert.ok(fetched);
  assert.equal(fetched!.symbol, "EURUSD");
  assert.equal(fetched!.targets[0], 1.08651);

  const listed = await store.listTrackedRecommendations(owner, { limit: 50 });
  assert.ok(listed.some((r) => r.id === created.id));

  const mapped = mapHistoricalRecommendationContext({
    contextJson: null,
    riskJson: JSON.stringify(legacyRisk),
    action: "buy",
    entry: fetched!.entry,
    stopLoss: fetched!.stopLoss,
    takeProfit: fetched!.targets[0] ?? null,
    confidence: 74,
    rationale: "Legacy candidate-backed recommendation",
  });
  assert.equal(mapped.kind, "historical_compat");
  assert.equal(mapped.modelPlan, null);
  assert.equal(mapped.display.hasPoiScoreCompat, true);
  assert.equal(mapped.display.decision, "buy");
  assert.equal(mapped.display.entry, 1.08501);
  assert.equal(
    (mapped as { selectedTradeCandidateId?: string }).selectedTradeCandidateId,
    undefined,
  );

  const stats = computeRecommendationStats(listed);
  assert.ok(stats.total >= 1);
  assert.ok(
    listed.some((r) => r.id === created.id && r.outcome === "loss"),
    "historical loss outcome must remain on the listed record",
  );
  assert.ok(stats.breakdown.loss >= 0);

  const other = await store.listTrackedRecommendations(attacker, { limit: 50 });
  assert.equal(
    other.some((r) => r.id === created.id),
    false,
  );
});
