import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolated SQLite — set BEFORE the dynamic imports below run.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "usage-meter-")), "test.db");
delete process.env.DATABASE_URL;

/* eslint-disable @typescript-eslint/no-explicit-any */
let queryOne: any;
let query: any;
let computeCosts: any;
let recordLLMUsage: any;
let withUsageContext: any;

before(async () => {
  const db = await import("@/lib/db");
  ({ queryOne, query } = db);
  ({ computeCosts, recordLLMUsage, withUsageContext } = await import("../usageMeter"));
  await db.initDb();
});

const flush = () => new Promise((r) => setTimeout(r, 150));

describe("computeCosts", () => {
  it("prices tokens per million and applies the retail multiplier", () => {
    const costs = computeCosts(
      { input_usd_per_m: 5, output_usd_per_m: 30 },
      20_000,
      3_000,
      1.5,
    );
    // 20K in @$5/M = $0.10 + 3K out @$30/M = $0.09 → $0.19 provider cost.
    assert.ok(Math.abs((costs.provider ?? 0) - 0.19) < 1e-9);
    assert.ok(Math.abs((costs.retail ?? 0) - 0.285) < 1e-9);
  });

  it("returns null costs when no price row exists — a visible gap, not zero", () => {
    const costs = computeCosts(null, 1000, 1000, 1.6);
    assert.equal(costs.provider, null);
    assert.equal(costs.retail, null);
  });
});

describe("recordLLMUsage", () => {
  it("writes a row with the route context and seeded prices", async () => {
    withUsageContext({ userId: 42, kind: "analysis", requestId: "req-1" }, () =>
      recordLLMUsage({
        provider: "openai",
        model: "gpt-5.6-sol",
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    );
    await flush();
    const row = await queryOne("SELECT * FROM usage_events WHERE user_id = 42");
    assert.ok(row, "usage row must exist");
    assert.equal(row!.kind, "analysis");
    assert.equal(row!.request_id, "req-1");
    // 1M input tokens of gpt-5.6-sol = $5 exactly; default multiplier 1.
    assert.ok(Math.abs(row!.provider_cost_usd - 5) < 1e-9);
    assert.ok(Math.abs(row!.retail_cost_usd - 5) < 1e-9);
  });

  it("records system spend as user_id NULL when no context is set", async () => {
    recordLLMUsage({
      provider: "anthropic",
      model: "claude-sonnet-5",
      inputTokens: 500,
      outputTokens: 500,
    });
    await flush();
    const row = await queryOne(
      "SELECT kind FROM usage_events WHERE user_id IS NULL AND model = 'claude-sonnet-5'",
    );
    assert.ok(row, "system row must exist");
    assert.equal(row!.kind, "other");
  });

  it("normalizes legacy openai/ prefixes so prices still match", async () => {
    withUsageContext({ userId: 43, kind: "chat" }, () =>
      recordLLMUsage({
        provider: "openai",
        model: "openai/GPT-5.6-LUNA",
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    );
    await flush();
    const row = await queryOne(
      "SELECT model, provider_cost_usd FROM usage_events WHERE user_id = 43",
    );
    assert.equal(row!.model, "gpt-5.6-luna");
    assert.ok(Math.abs(row!.provider_cost_usd - 0.2) < 1e-9);
  });

  it("stores NULL costs for an unknown model instead of inventing zero", async () => {
    withUsageContext({ userId: 44, kind: "chat" }, () =>
      recordLLMUsage({
        provider: "openai",
        model: "gpt-99-imaginary",
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    );
    await flush();
    const row = await queryOne(
      "SELECT provider_cost_usd FROM usage_events WHERE user_id = 44",
    );
    assert.ok(row);
    assert.equal(row!.provider_cost_usd, null);
  });

  it("skips zero-token results entirely", async () => {
    withUsageContext({ userId: 45, kind: "chat" }, () =>
      recordLLMUsage({
        provider: "openai",
        model: "gpt-5.6-sol",
        inputTokens: 0,
        outputTokens: 0,
      }),
    );
    await flush();
    const rows = await query("SELECT id FROM usage_events WHERE user_id = 45");
    assert.equal(rows.length, 0);
  });
});
