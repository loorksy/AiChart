import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("run trace persists safe tenant-scoped completed/cancelled/failed metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-trace-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["trace-owner@test.com", "x", "user", "active"],
  );
  const other = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["trace-other@test.com", "x", "user", "active"],
  );
  const trace = await import("@/lib/agent/runTrace");
  const runId = await trace.startAgentRun({
    userId: owner, requestId: "req-1", sessionId: "s1", contextVersion: "v2",
    contextMessageCount: 5, recalledMemoryCount: 2, skillNames: ["trading-lexicon"],
  });
  assert.ok(runId);
  assert.equal(await trace.getAgentRunForUser(other, runId!), null);
  assert.equal(await trace.addAgentRunStep({
    userId: owner, runId: runId!, type: "final_decision", status: "completed",
    summary: `safe ${"x".repeat(2_000)} Authorization: Bearer abcdefghijklmnop`,
    evidence: { decision: "wait", privateKey: "-----BEGIN PRIVATE KEY-----x" },
  }), true);
  assert.equal(await trace.recordAgentToolCall({
    runId: runId!, userId: owner,
    event: {
      requestId: "req-1", userId: owner, tool: "market_snapshot", version: "1.0.0",
      permission: "market.read", status: "completed", durationMs: 12,
      inputPreview: "Bearer abcdefghijklmnop", outputPreview: "ok",
    },
  }), true);
  assert.equal(await trace.finalizeAgentRun({ userId: owner, runId: runId!, status: "cancelled" }), true);
  const stored = await trace.getAgentRunForUser<{ status: string; cancelled_at: number }>(owner, runId!);
  assert.equal(stored?.status, "cancelled");
  assert.ok(stored?.cancelled_at);
  const step = await db.queryOne<{ summary: string }>("SELECT summary FROM agent_run_steps WHERE run_id = ?", [runId]);
  assert.doesNotMatch(step?.summary ?? "", /abcdefghijklmnop/);
  assert.ok((step?.summary.length ?? 0) <= 1_100);
  const tool = await db.queryOne<{ input_preview: string }>("SELECT input_preview FROM agent_tool_calls WHERE run_id = ?", [runId]);
  assert.doesNotMatch(tool?.input_preview ?? "", /abcdefghijklmnop/);

  const failed = await trace.startAgentRun({ userId: owner, requestId: "req-2" });
  assert.ok(failed);
  assert.equal(await trace.finalizeAgentRun({ userId: owner, runId: failed!, status: "failed", errorCode: "SAFE_CODE" }), true);
  assert.equal((await trace.getAgentRunForUser<{ status: string }>(owner, failed!))?.status, "failed");
  assert.equal(await trace.addAgentRunStep({ userId: owner, runId: "missing", type: "x", status: "failed" }), false);
});
