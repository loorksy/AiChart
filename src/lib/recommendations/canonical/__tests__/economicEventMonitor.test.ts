import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { gatedCompletePlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";

const dir = mkdtempSync(join(tmpdir(), "aichart-econ-events-"));
process.env.DB_PATH = join(dir, "econ.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "econ-test-secret";
delete process.env.DATABASE_URL;

/**
 * Economic-event proximity (plan §8 C.6), through the database.
 *
 * The provider is injected — the module must never invent a calendar, and a
 * test key would make the suite depend on someone else's rate limit. What runs
 * for real: the active-recommendation read, the lifecycle notifier's persisted
 * dedupe, the trigger rate limiter, and the recorded trigger history.
 */

let db: typeof import("@/lib/db");
let monitor: typeof import("@/lib/recommendations/economicEventMonitor");
let repository: typeof import("@/lib/recommendations/canonical/repository");
let userId = 0;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  monitor = await import("@/lib/recommendations/economicEventMonitor");
  repository = await import("@/lib/recommendations/canonical/repository");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["econ@example.com", "x", "user", "active"],
  );
  // Lifecycle tests model paying subscribers — the 3-recommendation trial
  // cap is covered by the subscription suite, not here.
  await db.execute(
    "INSERT INTO user_entitlements (user_id, plan_status) VALUES (?, 'active')",
    [userId],
  );
});

/** A live plan the operator is holding, created the way the platform does. */
async function livePlan(symbol = "XAUUSD"): Promise<number> {
  const rec = await repository.createCanonicalRecommendation({
    userId,
    symbol,
    market: "forex",
    timeframe: "5m",
    direction: "buy",
    entry: 4000,
    stopLoss: 3980,
    targets: [4040],
    ...(await gatedCompletePlan(userId, { planType: "conditional", symbol })),
    executionState: "awaiting_activation",
    status: "active",
    source: "test",
    engineVersion: "econ-test",
  });
  return rec.recommendationId;
}

/** A calendar with one high-impact USD release N minutes out. */
function providerWith(events: Array<{ title: string; minutes: number; impact: "low" | "medium" | "high"; currency?: string }>, now: number) {
  return {
    getEconomicEvents: async () =>
      events.map((event) => ({
        title: event.title,
        time: new Date(now + event.minutes * 60_000).toISOString(),
        impact: event.impact,
        currency: event.currency,
      })),
  };
}

async function dedupeRows(): Promise<Array<{ dedupe_key: string }>> {
  return db.query<{ dedupe_key: string }>(
    "SELECT dedupe_key FROM alert_dedupe WHERE user_id = ? AND event_type = 'economic_event_near'",
    [userId],
  );
}

describe("a high-impact release near an active plan is announced exactly once", () => {
  it("notifies on the first sweep and dedupes the second", async () => {
    const id = await livePlan();
    const now = Date.now();
    const provider = providerWith(
      [{ title: "FOMC Rate Decision", minutes: 30, impact: "high", currency: "USD" }],
      now,
    );
    const cycleCalls: number[] = [];
    const deps = {
      provider,
      providerConfigured: true,
      now,
      runCycles: async (items: ReadonlyArray<{ canonicalId: number }>) => {
        cycleCalls.push(...items.map((item) => item.canonicalId));
        return [];
      },
    };

    const first = await monitor.checkEconomicEventProximity(userId, deps);
    assert.equal(first.events.length, 1);
    assert.match(first.events[0]!.detail, /FOMC Rate Decision/);
    assert.equal(first.events[0]!.revisionNo, 1);
    assert.equal(first.notify.suppressedDuplicate, 0);
    // The persisted key carries (rec, event, revision) — the dedupe identity.
    const claimed = await dedupeRows();
    assert.equal(claimed.length, 1);
    assert.match(claimed[0]!.dedupe_key, new RegExp(`^${id}:1:economic_event_near:`));

    // The same sweep an hour later must stay silent for the same release.
    const second = await monitor.checkEconomicEventProximity(userId, deps);
    assert.equal(second.events.length, 1, "the event is still derived");
    assert.equal(second.notify.suppressedDuplicate, 1, "but its delivery is deduped");
    assert.equal((await dedupeRows()).length, 1, "no second dedupe row");
    void cycleCalls;
  });

  it("admits a re-evaluation trigger with the existing economic_event reason", async () => {
    const id = await livePlan("EURUSD");
    const now = Date.now();
    const cycleCalls: Array<{ canonicalId: number; reason: string }> = [];
    const deps = {
      provider: providerWith(
        [{ title: "ECB Press Conference", minutes: 20, impact: "high", currency: "EUR" }],
        now,
      ),
      providerConfigured: true,
      now,
      runCycles: async (
        items: ReadonlyArray<{ trigger: { reason: string }; canonicalId: number }>,
      ) => {
        for (const item of items) {
          cycleCalls.push({ canonicalId: item.canonicalId, reason: item.trigger.reason });
        }
        return [];
      },
    };

    const first = await monitor.checkEconomicEventProximity(userId, deps);
    assert.equal(first.admittedTriggers.length, 1);
    assert.equal(first.admittedTriggers[0]!.reason, "economic_event");
    assert.equal(first.admittedTriggers[0]!.source, "monitor");
    // Triggers carry NO direction and NO levels — the brain re-decides.
    assert.ok(!("direction" in first.admittedTriggers[0]!));
    assert.deepEqual(cycleCalls, [{ canonicalId: id, reason: "economic_event" }]);

    const recorded = await db.query<{ reason: string; outcome: string }>(
      "SELECT reason, outcome FROM recommendation_reevaluations WHERE recommendation_id = ?",
      [String(id)],
    );
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.reason, "economic_event");
    assert.equal(recorded[0]!.outcome, "cycle_requested");

    // Within the cooldown the same condition asks for no second cycle.
    const second = await monitor.checkEconomicEventProximity(userId, deps);
    assert.equal(second.admittedTriggers.length, 0);
    assert.equal(cycleCalls.length, 1, "no second brain cycle inside the cooldown");
  });
});

describe("honest absence — no provider means nothing, never an invention", () => {
  it("produces nothing when no provider is configured", async () => {
    await livePlan("GBPUSD");
    const baseline = (await dedupeRows()).length;
    const result = await monitor.checkEconomicEventProximity(userId, {
      providerConfigured: false,
    });
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.admittedTriggers, []);
    assert.equal((await dedupeRows()).length, baseline, "no dedupe rows fabricated");
  });

  it("produces nothing when the provider fails to construct", async () => {
    const result = await monitor.checkEconomicEventProximity(userId, {
      providerConfigured: true,
      provider: null,
    });
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.admittedTriggers, []);
  });

  it("ignores low-impact and out-of-window releases", async () => {
    await livePlan("USDJPY");
    const now = Date.now();
    const result = await monitor.checkEconomicEventProximity(userId, {
      providerConfigured: true,
      now,
      provider: providerWith(
        [
          { title: "Minor survey", minutes: 10, impact: "low", currency: "JPY" },
          { title: "BOJ later today", minutes: 240, impact: "high", currency: "JPY" },
        ],
        now,
      ),
      runCycles: async () => [],
    });
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.admittedTriggers, []);
  });
});
