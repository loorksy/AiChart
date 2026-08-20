import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { describe, it, test } from "node:test";
import {
  gatedTrackedPlan,
  trackedCompletePlan,
} from "@/lib/recommendations/__tests__/fixtures/completePlan";

const here = dirname(fileURLToPath(import.meta.url));

describe("recommendation sweep — no LLM, no execution (static import scan)", () => {
  const trackerSrc = readFileSync(
    join(here, "..", "recommendationTracker.ts"),
    "utf8",
  );
  const routeSrc = readFileSync(
    join(here, "..", "..", "..", "app", "api", "cron", "recommendation-sweep", "route.ts"),
    "utf8",
  );

  it("tracker imports neither an LLM client nor an execution/broker path", () => {
    for (const banned of ["@/lib/llm", "openai", "orchestrator", "brokers/", "executionDesk", "open_trade"]) {
      assert.ok(!trackerSrc.includes(banned), `tracker must not import ${banned}`);
    }
  });

  it("cron route is authenticated and overlap-locked, with no LLM/exec imports", () => {
    assert.ok(routeSrc.includes("verifyCronSecret"), "route must verify the cron secret");
    assert.ok(routeSrc.includes("withLock"), "route must hold a distributed lock");
    for (const banned of ["@/lib/llm", "openai", "orchestrator", "brokers/"]) {
      assert.ok(!routeSrc.includes(banned), `route must not import ${banned}`);
    }
  });
});

test("sweep: non-terminal filtering, idempotency, and safe no-op", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lonora-sweep-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["sweep@rec.com", "x", "user", "active"],
  );

  const store = await import("@/lib/recommendations/recommendationStore");
  const { runRecommendationSweep } = await import("@/lib/recommendations/recommendationTracker");
  const now = Date.now();

  // Empty state → safe no-op.
  const empty = await runRecommendationSweep();
  assert.equal(empty.checked, 0);
  assert.equal(empty.updated, 0);

  const baseRec = {
    ...trackedCompletePlan(),
    userId,
    chatId: "c1",
    symbol: "XAUUSD",
    interval: "15m" as const,
    direction: "buy" as const,
    entryType: "market" as const,
    entry: 100,
    stopLoss: 99,
    targets: [102],
    invalidationLevel: 99,
    createdAt: now,
    createdCandleTime: now,
    expiresAt: now + 4 * 3600_000,
  };

  // Two active (pending) + one already-terminal recommendation. Each create
  // carries its own recorded gate-chain authorization for its symbol.
  await store.createTrackedRecommendation({
    ...baseRec,
    ...(await gatedTrackedPlan(userId, { analysisId: "sweep-pending-1", symbol: "XAUUSD" })),
    id: "pending-1", status: "pending_entry", outcome: "pending",
  });
  await store.createTrackedRecommendation({
    ...baseRec,
    ...(await gatedTrackedPlan(userId, { analysisId: "sweep-pending-2", symbol: "EURUSD" })),
    id: "pending-2", symbol: "EURUSD", status: "triggered", outcome: "pending", triggeredAt: now,
  });
  await store.createTrackedRecommendation({
    ...baseRec,
    ...(await gatedTrackedPlan(userId, { analysisId: "sweep-terminal-1", symbol: "XAUUSD" })),
    id: "terminal-1", status: "tp1_hit", outcome: "win_tp1",
  });

  // Only the two non-terminal (outcome=pending) recs are swept.
  const first = await runRecommendationSweep();
  assert.equal(first.checked, 2, "terminal recommendation is excluded");

  // Idempotent: a second sweep over the same candles processes the same set and
  // does not resurrect or double-count the terminal one.
  const second = await runRecommendationSweep();
  assert.equal(second.checked, 2);

  // The terminal recommendation stayed terminal (never re-opened).
  const active = await store.listActiveTrackedRecommendations({ userId });
  assert.ok(!active.some((r) => r.id === "terminal-1"));
});
