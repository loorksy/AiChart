import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-gate-enforce-"));
process.env.DB_PATH = join(dir, "gates.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "gates-test-secret";
delete process.env.DATABASE_URL;

let userId = 0;
let lifecycle: typeof import("@/lib/recommendations/canonical");
let gateRecords: typeof import("@/lib/recommendations/gateRecords");
let fixtures: typeof import("./fixtures/completePlan");

function planInput(overrides: Record<string, unknown> = {}) {
  return {
    userId,
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "1h",
    direction: "buy" as const,
    entry: 4000,
    stopLoss: 3990,
    targets: [4010, 4020, 4030],
    risk: { source: "recorded" },
    confidence: 70,
    source: "gate-test",
    ...overrides,
  };
}

function passVerdict(id: "G1" | "G2" | "G3" | "G4" | "G6" | "G7", name: string, at = Date.now()) {
  return {
    id,
    name,
    status: "pass" as const,
    startedAt: at - 200,
    finishedAt: at,
  };
}

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  lifecycle = await import("@/lib/recommendations/canonical");
  gateRecords = await import("@/lib/recommendations/gateRecords");
  fixtures = await import("./fixtures/completePlan");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["gates@example.com", "x", "user", "active"],
  );
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status) VALUES (?, 'active')
     ON CONFLICT (user_id) DO UPDATE SET plan_status = 'active'`,
    [userId],
  );
});

describe("the write boundary refuses ungated plans", () => {
  it("rejects a buy with no analysis_id at all", async () => {
    await assert.rejects(
      () =>
        lifecycle.createCanonicalRecommendation({
          ...fixtures.canonicalCompletePlan(),
          ...planInput(),
        }),
      (err: { code?: string; message: string }) => {
        assert.equal(err.code, "RECOMMENDATION_GATES_INCOMPLETE");
        assert.match(err.message, /names no analysis_id/);
        return true;
      },
    );
  });

  it("rejects an analysis id whose gate chain never ran", async () => {
    await assert.rejects(
      () =>
        lifecycle.createCanonicalRecommendation({
          ...fixtures.canonicalCompletePlan(),
          ...planInput({ analysisId: "never-ran-1" }),
        }),
      (err: { code?: string; message: string }) => {
        assert.equal(err.code, "RECOMMENDATION_GATES_INCOMPLETE");
        assert.match(err.message, /no gate records exist/);
        return true;
      },
    );
  });

  it("rejects an incomplete sequence, naming the missing gate", async () => {
    await gateRecords.recordGateChain({
      userId,
      analysisId: "missing-g7",
      symbol: "XAUUSD",
      chainAllowed: true,
      verdicts: [
        passVerdict("G1", "news_and_events"),
        passVerdict("G2", "liquidity_map"),
        passVerdict("G3", "supply_demand"),
        passVerdict("G4", "structure_and_bias"),
        // G7 (final live-price verification) never ran.
      ],
    });
    await assert.rejects(
      () =>
        lifecycle.createCanonicalRecommendation({
          ...fixtures.canonicalCompletePlan(),
          ...planInput({ analysisId: "missing-g7" }),
        }),
      (err: { code?: string; message: string }) => {
        assert.equal(err.code, "RECOMMENDATION_GATES_INCOMPLETE");
        assert.match(err.message, /G7/);
        return true;
      },
    );
  });

  it("reports a news-window veto as the explicit reason — never silence", async () => {
    const now = Date.now();
    await gateRecords.recordGateChain({
      userId,
      analysisId: "news-blocked",
      symbol: "XAUUSD",
      chainAllowed: false,
      verdicts: [
        {
          id: "G1",
          name: "news_and_events",
          status: "veto",
          reasonAr: "قرار الفائدة الأمريكي بعد 12 دقيقة — نافذة حظر الأخبار فعالة.",
          startedAt: now - 200,
          finishedAt: now,
        },
        passVerdict("G2", "liquidity_map", now),
        passVerdict("G3", "supply_demand", now),
        passVerdict("G4", "structure_and_bias", now),
        passVerdict("G7", "live_revalidation", now),
      ],
    });
    await assert.rejects(
      () =>
        lifecycle.createCanonicalRecommendation({
          ...fixtures.canonicalCompletePlan(),
          ...planInput({ analysisId: "news-blocked" }),
        }),
      (err: { code?: string; message: string }) => {
        assert.equal(err.code, "RECOMMENDATION_GATES_INCOMPLETE");
        assert.match(err.message, /G1/);
        assert.match(err.message, /نافذة حظر الأخبار/);
        return true;
      },
    );
  });

  it("rejects stale records — the market moved on", async () => {
    const old = Date.now() - 30 * 60 * 1000;
    await gateRecords.recordGateChain({
      userId,
      analysisId: "stale-1",
      symbol: "XAUUSD",
      chainAllowed: true,
      verdicts: [
        passVerdict("G1", "news_and_events", old),
        passVerdict("G2", "liquidity_map", old),
        passVerdict("G3", "supply_demand", old),
        passVerdict("G4", "structure_and_bias", old),
        passVerdict("G7", "live_revalidation", old),
      ],
    });
    await assert.rejects(
      () =>
        lifecycle.createCanonicalRecommendation({
          ...fixtures.canonicalCompletePlan(),
          ...planInput({ analysisId: "stale-1" }),
        }),
      (err: { code?: string; message: string }) => {
        assert.equal(err.code, "RECOMMENDATION_GATES_INCOMPLETE");
        assert.match(err.message, /stale/i);
        return true;
      },
    );
  });

  it("accepts a fresh, complete, non-vetoed chain — and stores the resolved fill type", async () => {
    const input = await fixtures.gatedCompletePlan(userId);
    const created = await lifecycle.createCanonicalRecommendation({
      ...input,
      ...planInput({ analysisId: input.analysisId }),
    });
    assert.ok(created.recommendationId > 0);
    const db = await import("@/lib/db");
    const row = await db.queryOne<{ entry_type: string | null }>(
      "SELECT entry_type FROM recommendations WHERE id = ?",
      [created.recommendationId],
    );
    // Explicit fill semantics on every stored plan — never NULL for new rows.
    assert.equal(row?.entry_type, "market");
  });
});

describe("coherence and factor evidence are refused at the write itself", () => {
  it("rejects the fatal entry/activation pair (close-based rule, touch entry at its level)", async () => {
    const input = await fixtures.gatedCompletePlan(userId, {
      planType: "conditional",
      activationRule: { kind: "candle_close_above", level: 4000, timeframe: "1h" },
      activationCondition: "إغلاق شمعة ساعة فوق مستوى 4000 يفعّل الخطة",
    });
    await assert.rejects(
      () =>
        lifecycle.createCanonicalRecommendation({
          ...input,
          ...planInput({ analysisId: input.analysisId, entryType: "limit_touch", entry: 4000 }),
        }),
      (err: { code?: string; message: string }) => {
        assert.equal(err.code, "RECOMMENDATION_INVALID_INPUT");
        assert.match(err.message, /close_rule_with_touch_entry/);
        return true;
      },
    );
  });

  it("resolves close-based plans to confirmation_close fill semantics", async () => {
    const input = await fixtures.gatedCompletePlan(userId, {
      planType: "conditional",
      activationRule: { kind: "candle_close_above", level: 4005, timeframe: "1h" },
      activationCondition: "إغلاق شمعة ساعة فوق 4005 يفعّل الخطة",
    });
    const created = await lifecycle.createCanonicalRecommendation({
      ...input,
      ...planInput({ analysisId: input.analysisId, entry: 4005 }),
    });
    const db = await import("@/lib/db");
    const row = await db.queryOne<{ entry_type: string | null }>(
      "SELECT entry_type FROM recommendations WHERE id = ?",
      [created.recommendationId],
    );
    assert.equal(row?.entry_type, "confirmation_close");
  });

  it("rejects factors with no measurable source", async () => {
    const input = await fixtures.gatedCompletePlan(userId, {
      evidence: {
        evidenceDimensions: [
          { key: "vibes", grade: "strong", detail: "يبدو السوق ممتازاً" },
          { key: "mood", grade: "moderate", detail: "الاتجاه جيد" },
        ],
      },
    });
    await assert.rejects(
      () =>
        lifecycle.createCanonicalRecommendation({
          ...input,
          ...planInput({ analysisId: input.analysisId }),
        }),
      (err: { code?: string; message: string }) => {
        assert.equal(err.code, "RECOMMENDATION_INVALID_INPUT");
        assert.match(err.message, /no dimension carries a measurement/);
        return true;
      },
    );
  });

  it("rejects a plan with no evidence card at all", async () => {
    const input = await fixtures.gatedCompletePlan(userId);
    // gatedCompletePlan defaults a card; explicitly strip it to prove refusal.
    input.initialRevision.evidence = null as unknown as Record<string, unknown>;
    await assert.rejects(
      () =>
        lifecycle.createCanonicalRecommendation({
          ...input,
          ...planInput({ analysisId: input.analysisId }),
        }),
      (err: { code?: string; message: string }) => {
        assert.equal(err.code, "RECOMMENDATION_INVALID_INPUT");
        assert.match(err.message, /no evidence dimensions/);
        return true;
      },
    );
  });
});
