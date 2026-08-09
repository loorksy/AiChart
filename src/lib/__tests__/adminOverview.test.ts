import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "admin-overview-")), "test.db");
delete process.env.DATABASE_URL;

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** 2026-07-31T12:00:00Z — 15:00 in Riyadh, so "today" is 2026-07-31 there. */
const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
/** Midnight Riyadh on 2026-07-31. */
const TODAY_START = Date.UTC(2026, 6, 30, 21, 0, 0);
/** First bucket of the 7-day window: midnight Riyadh on 2026-07-25. */
const W7_FROM = TODAY_START - 6 * DAY;
const W7_PREV_FROM = W7_FROM - 7 * DAY;

const ALICE = 101;
const BOB = 102;
const CAROL = 103;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let overview: any;
let profitModel: any;
let roles: any;
let tiers: any;

/** The five queries /api/admin/billing/profit runs, verbatim. */
async function profitRouteRows() {
  return Promise.all([
    db.query(
      `SELECT user_id, kind, COUNT(*) as months FROM credit_ledger
       WHERE kind IN ('monthly_grant','gift','trial_grant') GROUP BY user_id, kind`,
    ),
    db.query(
      `SELECT user_id, SUM(amount_usd) as total FROM credit_ledger
       WHERE kind = 'topup' GROUP BY user_id`,
    ),
    db.query(
      `SELECT user_id, SUM(provider_cost_usd) as provider_cost,
              SUM(retail_cost_usd) as retail_cost, COUNT(*) as events
       FROM usage_events GROUP BY user_id`,
    ),
    db.query("SELECT user_id, tier, status FROM subscriptions"),
    db.query("SELECT id, email FROM users"),
  ]);
}

async function seedUser(
  id: number,
  email: string,
  createdAt: string,
  status = "active",
) {
  await db.execute(
    "INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES (?, ?, 'x', 'user', ?, ?)",
    [id, email, status, createdAt],
  );
}

async function seedLedger(userId: number, ts: number, kind: string, amount: number) {
  await db.execute(
    "INSERT INTO credit_ledger (user_id, ts, kind, amount_usd, bucket) VALUES (?, ?, ?, ?, 'monthly')",
    [userId, ts, kind, amount],
  );
}

async function seedEvent(
  userId: number | null,
  ts: number,
  providerCost: number | null,
  retailCost: number | null,
) {
  await db.execute(
    `INSERT INTO usage_events (user_id, ts, provider, model, kind, input_tokens, output_tokens, provider_cost_usd, retail_cost_usd)
     VALUES (?, ?, 'anthropic', 'claude-sonnet-5', 'analysis', 100, 200, ?, ?)`,
    [userId, ts, providerCost, retailCost],
  );
}

before(async () => {
  db = await import("@/lib/db");
  overview = await import("@/lib/admin/overviewQueries");
  profitModel = await import("@/lib/billing/profitModel");
  roles = await import("@/lib/adminRoles");
  tiers = await import("@/lib/billing/tiers");
  await db.initDb();

  await seedUser(ALICE, "alice@t.local", "2026-07-01 08:00:00");
  await seedUser(BOB, "bob@t.local", "2026-07-10 08:00:00");
  await seedUser(CAROL, "carol@t.local", "2026-07-20 08:00:00", "pending");

  // Legacy tier ids on stored rows — both resolve to the one $180 plan.
  // Carol never subscribed.
  await db.execute(
    `INSERT INTO subscriptions (user_id, tier, status, started_at, current_period_start, current_period_end, updated_at)
     VALUES (?, 'pro', 'active', ?, ?, ?, ?)`,
    [ALICE, TODAY_START, TODAY_START, TODAY_START + 30 * DAY, TODAY_START],
  );
  await db.execute(
    `INSERT INTO subscriptions (user_id, tier, status, started_at, current_period_start, current_period_end, updated_at)
     VALUES (?, 'lite', 'past_due', ?, ?, ?, ?)`,
    [BOB, TODAY_START, TODAY_START, TODAY_START + 30 * DAY, TODAY_START],
  );

  await db.execute(
    "INSERT INTO credit_balances (user_id, monthly_usd, topup_usd, period_end, updated_at) VALUES (?, ?, ?, ?, ?)",
    [ALICE, 45.5, 10.25, TODAY_START + 30 * DAY, TODAY_START],
  );

  // --- current 7-day window
  await seedLedger(ALICE, TODAY_START + HOUR, "monthly_grant", 160);
  await seedLedger(BOB, W7_FROM + 2 * HOUR, "monthly_grant", 45);
  await seedLedger(ALICE, W7_FROM + 3 * DAY, "topup", 50);
  await seedLedger(CAROL, W7_FROM + DAY, "gift", 25);
  await seedLedger(CAROL, W7_FROM + DAY + 1000, "trial_grant", 5);
  // --- previous 7-day window
  await seedLedger(ALICE, W7_PREV_FROM + HOUR, "monthly_grant", 160);

  await seedEvent(ALICE, W7_FROM + HOUR, 10, 20);
  await seedEvent(ALICE, TODAY_START + 2 * HOUR, 5, 12);
  // Priced at NULL: real cost unknown, so it must show up as an unpriced event.
  await seedEvent(ALICE, W7_FROM + 5 * HOUR, null, null);
  // 21:30 UTC on 07-26 is 00:30 Riyadh on 07-27 — the bucket must follow Riyadh.
  await seedEvent(BOB, Date.UTC(2026, 6, 26, 21, 30, 0), 100, 200);
  await seedEvent(null, W7_FROM + 4 * HOUR, 7, 0);
  await seedEvent(ALICE, W7_PREV_FROM + HOUR, 30, 60);
});

describe("Riyadh day bucketing", () => {
  it("buckets by Riyadh midnight, not by UTC midnight", () => {
    assert.equal(overview.riyadhDayKey(Date.UTC(2026, 6, 26, 21, 30, 0)), "2026-07-27");
    assert.equal(overview.riyadhDayKey(Date.UTC(2026, 6, 26, 20, 59, 59)), "2026-07-26");
    assert.equal(overview.startOfRiyadhDay(NOW), TODAY_START);
    assert.equal(overview.startOfRiyadhDay(TODAY_START), TODAY_START);
  });

  it("both windows span the same number of day buckets", () => {
    const w = overview.overviewWindow(7, NOW);
    assert.equal(w.from, W7_FROM);
    assert.equal(w.to, NOW);
    assert.equal(w.prevTo, W7_FROM);
    assert.equal(w.prevFrom, W7_PREV_FROM);
    assert.equal(w.prevTo - w.prevFrom, 7 * DAY);
  });

  it("resolvePeriod accepts only 7/30/90 and defaults to 30", () => {
    assert.equal(overview.resolvePeriod("7"), 7);
    assert.equal(overview.resolvePeriod("90"), 90);
    assert.equal(overview.resolvePeriod("30"), 30);
    assert.equal(overview.resolvePeriod("365"), 30);
    assert.equal(overview.resolvePeriod(null), 30);
    assert.equal(overview.resolvePeriod("nonsense"), 30);
  });
});

describe("toEpochMs across both dialects", () => {
  it("reads every shape the two drivers produce", () => {
    // SQLite INTEGER / pg BIGINT (no int8 parser registered → digit string).
    assert.equal(overview.toEpochMs(NOW), NOW);
    assert.equal(overview.toEpochMs(String(NOW)), NOW);
    // SQLite datetime('now') is naive but always UTC; pg TIMESTAMPTZ is ISO.
    assert.equal(
      overview.toEpochMs("2026-07-31 12:00:00"),
      Date.UTC(2026, 6, 31, 12, 0, 0),
    );
    assert.equal(
      overview.toEpochMs("2026-07-31T12:00:00.000Z"),
      Date.UTC(2026, 6, 31, 12, 0, 0),
    );
    assert.equal(overview.toEpochMs(new Date(NOW)), NOW);
  });

  it("returns null for unknown dates instead of pretending they are the epoch", () => {
    assert.equal(overview.toEpochMs(null), null);
    assert.equal(overview.toEpochMs(undefined), null);
    assert.equal(overview.toEpochMs(""), null);
    assert.equal(overview.toEpochMs("not a date"), null);
  });
});

describe("overview KPIs over a 7-day window", () => {
  it("computes revenue, cost and profit from real rows", async () => {
    const data = await overview.loadOverview(7, NOW);

    // 180 (alice grant) + 180 (bob grant) + 50 (alice top-up)
    assert.equal(data.kpis.revenue_usd.value, 410);
    assert.equal(data.kpis.revenue_usd.prev, 180);
    assert.equal(data.kpis.revenue_usd.pct, 127.78);

    // 10 + 5 (alice) + 100 (bob); the system row and the unpriced row add nothing.
    assert.equal(data.kpis.provider_cost_usd.value, 115);
    assert.equal(data.kpis.provider_cost_usd.prev, 30);

    assert.equal(data.kpis.profit_usd.value, 295);
    assert.equal(data.kpis.profit_usd.prev, 150);

    assert.equal(data.range.from, W7_FROM);
    assert.equal(data.range.to, NOW);
  });

  it("keeps platform spend out of the per-user cost KPI", async () => {
    const data = await overview.loadOverview(7, NOW);
    assert.equal(data.kpis.system_cost_usd, 7);
    assert.equal(data.kpis.provider_cost_usd.value, 115, "system spend is not per-user");
  });

  it("surfaces unpriced events rather than letting them understate cost", async () => {
    const data = await overview.loadOverview(7, NOW);
    assert.equal(data.kpis.unpriced_events, 1);
  });

  it("counts paying, gift and trial users separately", async () => {
    const data = await overview.loadOverview(7, NOW);
    assert.equal(data.kpis.paying_subscribers.value, 2);
    assert.equal(data.kpis.paying_subscribers.prev, 1);
    assert.equal(data.kpis.paying_subscribers.pct, 100);
    assert.equal(data.kpis.gift_users, 1);
    assert.equal(data.kpis.trial_users, 1);
  });

  it("reports an undefined ratio as null, never as infinity", async () => {
    // A 90-day window swallows the previous window entirely, so every prev is 0.
    const data = await overview.loadOverview(90, NOW);
    assert.equal(data.kpis.revenue_usd.prev, 0);
    assert.equal(data.kpis.revenue_usd.pct, null);
    assert.equal(data.kpis.paying_subscribers.pct, null);
  });
});

describe("overview series", () => {
  it("returns exactly `days` zero-seeded points in Riyadh day order", async () => {
    const seven = await overview.loadOverview(7, NOW);
    assert.equal(seven.series.length, 7);
    assert.equal(seven.series[0].day, "2026-07-25");
    assert.equal(seven.series[6].day, "2026-07-31");

    const ninety = await overview.loadOverview(90, NOW);
    assert.equal(ninety.series.length, 90);
    assert.equal(ninety.series[89].day, "2026-07-31");

    const empty = seven.series.find((p: any) => p.day === "2026-07-29");
    assert.deepEqual(empty, { day: "2026-07-29", revenue: 0, cost: 0, profit: 0 });
  });

  it("lands each row in its Riyadh bucket and sums back to the KPIs", async () => {
    const data = await overview.loadOverview(7, NOW);
    const byDay = new Map(data.series.map((p: any) => [p.day, p]));

    assert.deepEqual(byDay.get("2026-07-25"), {
      day: "2026-07-25",
      revenue: 180,
      cost: 10,
      profit: 170,
    });
    // bob's event is stamped 2026-07-26 in UTC — it belongs to 07-27 in Riyadh.
    assert.deepEqual(byDay.get("2026-07-27"), {
      day: "2026-07-27",
      revenue: 0,
      cost: 100,
      profit: -100,
    });
    assert.deepEqual(byDay.get("2026-07-28"), {
      day: "2026-07-28",
      revenue: 50,
      cost: 0,
      profit: 50,
    });
    assert.deepEqual(byDay.get("2026-07-31"), {
      day: "2026-07-31",
      revenue: 180,
      cost: 5,
      profit: 175,
    });

    const sum = (k: "revenue" | "cost") =>
      Math.round(data.series.reduce((a: number, p: any) => a + p[k], 0) * 100) / 100;
    assert.equal(sum("revenue"), data.kpis.revenue_usd.value);
    assert.equal(sum("cost"), data.kpis.provider_cost_usd.value);
  });
});

describe("overview leaderboard", () => {
  it("ranks by revenue and keeps loss-makers in the payload", async () => {
    const data = await overview.loadOverview(7, NOW);
    assert.equal(data.leaders.length, 2, "carol has only gift/trial rows — nothing to rank");

    assert.deepEqual(data.leaders[0], {
      user_id: ALICE,
      email: "alice@t.local",
      tier: "pro",
      revenue_usd: 230,
      provider_cost_usd: 15,
      profit_usd: 215,
      events: 3,
    });
    assert.equal(data.leaders[1].email, "bob@t.local");
    assert.equal(data.leaders[1].profit_usd, 80, "180 grant − 100 provider cost");

    // The client re-sorts these same rows for the «الأكثر خسارة» view.
    const byLoss = [...data.leaders].sort((a: any, b: any) => a.profit_usd - b.profit_usd);
    assert.equal(byLoss[0].email, "bob@t.local");
  });

  it("never exceeds eight rows", async () => {
    const data = await overview.loadOverview(90, NOW);
    assert.ok(data.leaders.length <= 8);
  });
});

describe("the two admin money screens agree (R7)", () => {
  it("overview KPI totals equal /api/admin/billing/profit totals", async () => {
    const [grants, topups, costs, subs, users] = await profitRouteRows();
    const route = profitModel.reduceProfit({ grants, topups, costs, subs, users });

    // Every seeded row sits inside the last 90 days, so the window is all-time.
    const data = await overview.loadOverview(90, NOW);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    assert.equal(data.kpis.revenue_usd.value, round2(route.totals.revenue_usd));
    assert.equal(
      data.kpis.provider_cost_usd.value,
      round2(route.totals.provider_cost_usd),
    );
    assert.equal(data.kpis.profit_usd.value, round2(route.totals.profit_usd));
    assert.equal(data.kpis.system_cost_usd, round2(route.systemCostUsd));

    assert.equal(route.totals.revenue_usd, 590, "2×180 (alice) + 50 + 180 (bob)");
    assert.equal(route.totals.provider_cost_usd, 145, "45 (alice) + 100 (bob)");
    assert.equal(route.systemCostUsd, 7);
  });

  it("reproduces the profit route's old body byte for byte", async () => {
    const [grants, topups, costs, subs, users] = await profitRouteRows();

    // The reducer exactly as it read INLINE in /api/admin/billing/profit before
    // it moved into profitModel. Kept here on purpose: it is the only thing that
    // can catch the extraction silently reshaping a screen the operator trusts.
    const emailById = new Map(users.map((u: any) => [u.id, u.email]));
    const tierById = new Map(subs.map((s: any) => [s.user_id, s]));
    const legacyRows = new Map<number, any>();
    const ensure = (userId: number) => {
      let row = legacyRows.get(userId);
      if (!row) {
        const sub: any = tierById.get(userId);
        row = {
          user_id: userId,
          email: emailById.get(userId) ?? `#${userId}`,
          tier: sub?.tier ?? null,
          status: sub?.status ?? null,
          revenue_usd: 0,
          provider_cost_usd: 0,
          retail_burn_usd: 0,
          events: 0,
          gift_months: 0,
        };
        legacyRows.set(userId, row);
      }
      return row;
    };
    for (const g of grants as any[]) {
      const row = ensure(g.user_id);
      if (g.kind === "monthly_grant") {
        // The one deliberate divergence from the pre-extraction body: pricing
        // goes through tierDef so legacy tier ids resolve to the single plan.
        const tier = tiers.tierDef(row.tier ?? "");
        row.revenue_usd += (tier?.priceUsd ?? 0) * Number(g.months);
      } else {
        row.gift_months += Number(g.months);
      }
    }
    for (const t of topups as any[]) ensure(t.user_id).revenue_usd += Number(t.total ?? 0);
    let legacySystemCost = 0;
    for (const c of costs as any[]) {
      if (c.user_id == null) {
        legacySystemCost += Number(c.provider_cost ?? 0);
        continue;
      }
      const row = ensure(c.user_id);
      row.provider_cost_usd = Number(c.provider_cost ?? 0);
      row.retail_burn_usd = Number(c.retail_cost ?? 0);
      row.events = Number(c.events ?? 0);
    }
    const legacyPerUser = [...legacyRows.values()]
      .map((r) => ({ ...r, profit_usd: r.revenue_usd - r.provider_cost_usd }))
      .sort((a, b) => a.profit_usd - b.profit_usd);
    const legacyTotals = legacyPerUser.reduce(
      (acc, r) => ({
        revenue_usd: acc.revenue_usd + r.revenue_usd,
        provider_cost_usd: acc.provider_cost_usd + r.provider_cost_usd,
        profit_usd: acc.profit_usd + r.profit_usd,
      }),
      { revenue_usd: 0, provider_cost_usd: 0, profit_usd: 0 },
    );

    const now = profitModel.reduceProfit({ grants, topups, costs, subs, users });

    // JSON.stringify, not deepEqual: key ORDER is part of the wire format.
    assert.equal(
      JSON.stringify({
        per_user: now.perUser,
        totals: { ...now.totals, system_cost_usd: now.systemCostUsd },
      }),
      JSON.stringify({
        per_user: legacyPerUser,
        totals: { ...legacyTotals, system_cost_usd: legacySystemCost },
      }),
    );
  });

  it("prices gift and trial grants at zero", () => {
    const result = profitModel.reduceProfit({
      grants: [
        { user_id: 1, kind: "gift", months: 3 },
        { user_id: 1, kind: "trial_grant", months: 1 },
      ],
      topups: [],
      costs: [{ user_id: 1, provider_cost: 12, retail_cost: 30, events: 4 }],
      subs: [{ user_id: 1, tier: "promax", status: "active" }],
      users: [{ id: 1, email: "gifted@t.local" }],
    });
    assert.equal(result.perUser[0].revenue_usd, 0);
    assert.equal(result.perUser[0].gift_months, 4);
    assert.equal(result.perUser[0].profit_usd, -12);
  });

  it("reads aggregates back as numbers when the driver hands over strings", () => {
    const result = profitModel.reduceProfit({
      grants: [{ user_id: 1, kind: "monthly_grant", months: "2" }],
      topups: [{ user_id: 1, total: "25.5" }],
      costs: [
        { user_id: 1, provider_cost: "3.5", retail_cost: "9", events: "7" },
        { user_id: null, provider_cost: "1.25", retail_cost: "0", events: "1" },
      ],
      subs: [{ user_id: 1, tier: "lite", status: "active" }],
      users: [{ id: 1, email: "pg@t.local" }],
    });
    assert.equal(result.perUser[0].revenue_usd, 180 * 2 + 25.5);
    assert.equal(result.perUser[0].provider_cost_usd, 3.5);
    assert.equal(result.perUser[0].events, 7);
    assert.equal(result.systemCostUsd, 1.25);
  });
});

describe("overview users table", () => {
  it("joins identity, subscription, balance, usage and money per user", async () => {
    const rows = await overview.loadOverviewUsers();
    const byEmail = new Map<string, any>(rows.map((r: any) => [r.email, r]));

    const alice = byEmail.get("alice@t.local");
    assert.equal(alice.user_id, ALICE);
    assert.equal(alice.status, "active");
    assert.equal(alice.tier, "pro");
    assert.equal(alice.sub_status, "active");
    assert.equal(alice.period_end_ms, TODAY_START + 30 * DAY);
    assert.equal(alice.monthly_usd, 45.5);
    assert.equal(alice.topup_usd, 10.25);
    assert.equal(alice.balance_usd, 55.75);
    assert.equal(alice.events, 4, "three current + one previous, unpriced included");
    assert.equal(alice.provider_cost_usd, 45);
    assert.equal(alice.retail_burn_usd, 92);
    assert.equal(alice.last_event_ms, TODAY_START + 2 * HOUR);
    assert.equal(alice.revenue_usd, 410, "2×180 + 50");
    assert.equal(alice.profit_usd, 365);
    assert.equal(alice.created_at_ms, Date.UTC(2026, 6, 1, 8, 0, 0));

    const bob = byEmail.get("bob@t.local");
    assert.equal(bob.tier, "lite");
    assert.equal(bob.sub_status, "past_due");
    assert.equal(bob.balance_usd, 0, "no credit_balances row is $0, not a guess");
    assert.equal(bob.profit_usd, 80);

    const carol = byEmail.get("carol@t.local");
    assert.equal(carol.status, "pending");
    assert.equal(carol.tier, null);
    assert.equal(carol.sub_status, null);
    assert.equal(carol.period_end_ms, null);
    assert.equal(carol.events, 0);
    assert.equal(carol.last_event_ms, null, "never used the product");
    assert.equal(carol.revenue_usd, 0);
    assert.equal(carol.profit_usd, 0);
  });

  it("orders newest signup first", async () => {
    const rows = await overview.loadOverviewUsers();
    const seeded = rows
      .filter((r: any) => [ALICE, BOB, CAROL].includes(r.user_id))
      .map((r: any) => r.user_id);
    assert.deepEqual(seeded, [CAROL, BOB, ALICE]);
  });

  it("zeroes money and profit columns the admin may not see", async () => {
    const rows = await overview.loadOverviewUsers();

    const noMoney = overview.redactUserRows(rows, { money: false, profit: false });
    const alice = noMoney.find((r: any) => r.user_id === ALICE);
    assert.equal(alice.balance_usd, 0);
    assert.equal(alice.provider_cost_usd, 0);
    assert.equal(alice.retail_burn_usd, 0);
    assert.equal(alice.revenue_usd, 0);
    assert.equal(alice.profit_usd, 0);
    assert.equal(alice.events, 4, "request volume is not a money column");
    assert.equal(alice.email, "alice@t.local");

    const moneyOnly = overview.redactUserRows(rows, { money: true, profit: false });
    const aliceMoney = moneyOnly.find((r: any) => r.user_id === ALICE);
    assert.equal(aliceMoney.balance_usd, 55.75);
    assert.equal(aliceMoney.provider_cost_usd, 45);
    assert.equal(aliceMoney.revenue_usd, 0, "revenue needs profit_read");
    assert.equal(aliceMoney.profit_usd, 0);
  });
});

describe("permissionsForRole (R8 — the UI can only hide what the API already gates)", () => {
  it("an owner holds every permission", () => {
    const owner = roles.permissionsForRole("owner");
    assert.equal(owner.length, 9);
    for (const p of [
      "users_read",
      "users_write",
      "billing_read",
      "billing_write",
      "profit_read",
      "content_write",
      "tickets",
      "keys_write",
      "roles_write",
    ]) {
      assert.ok(owner.includes(p), `owner is missing ${p}`);
    }
  });

  it("support never gets profit or keys — the overview must hand it null KPIs", () => {
    const support = roles.permissionsForRole("support");
    assert.deepEqual([...support].sort(), ["tickets", "users_read"]);
    assert.equal(support.includes("profit_read"), false);
    assert.equal(support.includes("keys_write"), false);
  });

  it("finance sees money but not keys or roles", () => {
    const finance = roles.permissionsForRole("finance");
    assert.deepEqual(
      [...finance].sort(),
      ["billing_read", "billing_write", "profit_read", "users_read"],
    );
  });

  it("content_manager cannot even read the user roster", () => {
    const content = roles.permissionsForRole("content_manager");
    assert.deepEqual(content, ["content_write"]);
    assert.equal(roles.roleAllows("content_manager", "users_read"), false);
  });

  it("every listed permission agrees with roleAllows", () => {
    for (const role of ["owner", "support", "user_manager", "content_manager", "finance"]) {
      for (const p of roles.permissionsForRole(role)) {
        assert.equal(roles.roleAllows(role, p), true, `${role} → ${p}`);
      }
    }
  });
});
