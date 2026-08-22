/**
 * The manual execution layer's hard guarantees, against the REAL ledger and
 * a fake broker:
 *
 *  - no linked account → the SERVER refuses (hiding a button is not a guard);
 *  - expired / waiting / closed plans → short named refusals;
 *  - the stop loss travels IN the order request, or nothing is sent;
 *  - a double press — same key or a different one — is ONE order;
 *  - a lost response is reconciled at the broker by clientId: found means
 *    filled, absent means failed, and only then may a fresh press send;
 *  - a size beyond free margin or off the broker's grid is refused before
 *    any HTTP;
 *  - the ledger records who/plan/account/volume/price/slippage/outcome.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-execution-"));
process.env.DB_PATH = join(dir, "execution.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "execution-test-secret";
delete process.env.DATABASE_URL;

import type { TrackedRecommendation } from "@/lib/recommendations/types";
import type {
  AccountInformation,
  SymbolSpecification,
  TradeResponse,
  MarketOrderInput,
  TradeApiAuth,
  ClientIdLookup,
} from "@/lib/execution/metaapiTrade";
import type { ExecutionDeps } from "@/lib/execution/orders";

let userId = 0;
let orders: typeof import("@/lib/execution/orders");
let volumeMod: typeof import("@/lib/execution/volume");
let tradeMod: typeof import("@/lib/execution/metaapiTrade");
let storeMod: typeof import("@/lib/execution/store");
let db: typeof import("@/lib/db");

const NOW = 1_760_000_000_000;
let recSeq = 0;

function plan(overrides: Partial<TrackedRecommendation> = {}): TrackedRecommendation {
  recSeq += 1;
  return {
    id: String(9000 + recSeq),
    canonicalId: 9000 + recSeq,
    userId,
    symbol: "XAUUSD",
    interval: "15m",
    direction: "buy",
    entryType: "market",
    entry: 4000,
    stopLoss: 3990,
    targets: [4015, 4030],
    status: "triggered",
    outcome: "pending",
    createdAt: NOW - 60_000,
    createdCandleTime: NOW - 60_000,
    expiresAt: NOW + 3_600_000,
    executionState: "valid_now",
    ...overrides,
  } as TrackedRecommendation;
}

interface FakeBroker {
  sends: MarketOrderInput[];
  sendImpl: (input: MarketOrderInput) => Promise<TradeResponse>;
  lookup: ClientIdLookup;
  lookups: number;
}

function doneResponse(): TradeResponse {
  return {
    ok: true,
    numericCode: 10009,
    stringCode: "TRADE_RETCODE_DONE",
    orderId: "ord-1",
    positionId: "pos-1",
    message: null,
  };
}

function fakeDeps(input: {
  rec?: TrackedRecommendation | null;
  broker?: Partial<FakeBroker>;
  balance?: number;
  freeMargin?: number;
  linked?: boolean;
}): { deps: ExecutionDeps; broker: FakeBroker } {
  const broker: FakeBroker = {
    sends: [],
    sendImpl: async () => doneResponse(),
    lookup: {
      position: {
        id: "pos-1",
        clientId: "any",
        symbol: "XAUUSD",
        type: "POSITION_TYPE_BUY",
        volume: 0.25,
        openPrice: 4000.4,
        stopLoss: 3990,
        takeProfit: 4015,
        profit: 0,
        swap: 0,
        commission: 0,
        time: new Date(NOW).toISOString(),
      },
      deal: null,
    },
    lookups: 0,
    ...input.broker,
  };
  const info: AccountInformation = {
    balance: input.balance ?? 10_000,
    equity: input.balance ?? 10_000,
    freeMargin: input.freeMargin ?? 9_000,
    leverage: 100,
    currency: "USD",
  };
  const spec: SymbolSpecification = {
    symbol: "XAUUSD",
    minVolume: 0.01,
    maxVolume: 50,
    volumeStep: 0.01,
    contractSize: 100,
  };
  const deps: ExecutionDeps = {
    now: () => NOW,
    getLink: async () =>
      input.linked === false
        ? null
        : ({
            user_id: userId,
            metaapi_account_id: "acct-1",
            broker_id: "server:test",
            server: "Test-Server",
            platform: "mt5",
            state: "DEPLOYED",
            login: "123",
            created_at: "",
            updated_at: "",
          } as Awaited<ReturnType<NonNullable<ExecutionDeps["getLink"]>>>),
    getToken: async () => "metaapi-test-token",
    getRegionFallback: async () => "london",
    readAccountInfo: async () => ({
      id: "acct-1",
      state: "DEPLOYED",
      login: "123",
      connectionStatus: "CONNECTED",
      region: "london",
    }),
    getRecommendation: async () => input.rec ?? null,
    getUserSettings: (async () => ({ per_trade_pct: 1 })) as unknown as ExecutionDeps["getUserSettings"],
    accountInformation: async () => info,
    symbolSpecification: async () => spec,
    livePrice: async () => 4000.2,
    sendOrder: async (_auth: TradeApiAuth, order: MarketOrderInput) => {
      broker.sends.push(order);
      return broker.sendImpl(order);
    },
    lookupClientId: async () => {
      broker.lookups += 1;
      return broker.lookup;
    },
  };
  return { deps, broker };
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  orders = await import("@/lib/execution/orders");
  volumeMod = await import("@/lib/execution/volume");
  tradeMod = await import("@/lib/execution/metaapiTrade");
  storeMod = await import("@/lib/execution/store");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["execution@example.com", "x", "user", "active"],
  );
});

beforeEach(async () => {
  await db.execute("DELETE FROM executions", []);
});

describe("volume arithmetic", () => {
  it("suggests risk-based lots floored to the step and clamped to bounds", () => {
    const suggestion = volumeMod.suggestVolume({
      balance: 10_000,
      riskPct: 1, // $100 risk
      entry: 4000,
      stopLoss: 3990, // $10 stop → $1000/lot at 100 oz
      contractSize: 100,
      minVolume: 0.01,
      maxVolume: 50,
      volumeStep: 0.01,
    });
    assert.equal(suggestion.volume, 0.1);
    assert.equal(suggestion.riskAmount, 100);
    // Never rounds risk UP: 0.157... floors to 0.15.
    const floored = volumeMod.suggestVolume({
      balance: 10_000,
      riskPct: 1,
      entry: 4000,
      stopLoss: 3993.65,
      contractSize: 100,
      minVolume: 0.01,
      maxVolume: 50,
      volumeStep: 0.01,
    });
    assert.equal(floored.volume, 0.15);
  });

  it("refuses off-grid and out-of-bounds sizes with the short code", () => {
    const bounds = { minVolume: 0.01, maxVolume: 50, volumeStep: 0.01 };
    assert.equal(volumeMod.validateVolume(0.255, bounds).ok, false);
    assert.equal(volumeMod.validateVolume(0.005, bounds).ok, false);
    assert.equal(volumeMod.validateVolume(51, bounds).ok, false);
    const ok = volumeMod.validateVolume(0.25, bounds);
    assert.ok(ok.ok && ok.volume === 0.25);
  });
});

describe("the order payload", () => {
  it("refuses to exist without its stop loss", () => {
    assert.throws(
      () =>
        tradeMod.buildMarketOrderPayload({
          direction: "buy",
          symbol: "XAUUSD",
          volume: 0.1,
          stopLoss: 0,
          clientId: "c1",
        }),
      /stop/i,
    );
  });

  it("carries the stop (and TP) in the SAME request payload", () => {
    const payload = tradeMod.buildMarketOrderPayload({
      direction: "sell",
      symbol: "XAUUSD",
      volume: 0.2,
      stopLoss: 4010,
      takeProfit: 3980,
      clientId: "c2",
    });
    assert.equal(payload.actionType, "ORDER_TYPE_SELL");
    assert.equal(payload.stopLoss, 4010);
    assert.equal(payload.takeProfit, 3980);
    assert.equal(payload.clientId, "c2");
  });
});

describe("executeRecommendation guards", () => {
  it("refuses without a linked account — server-side, not just a hidden button", async () => {
    const { deps, broker } = fakeDeps({ rec: plan(), linked: false });
    const result = await orders.executeRecommendation(
      { userId, recommendationId: "1", volume: 0.1, idempotencyKey: "k-unlinked" },
      deps,
    );
    assert.deepEqual(result, { ok: false, code: "not_linked" });
    assert.equal(broker.sends.length, 0);
  });

  it("refuses an expired recommendation by name", async () => {
    const { deps, broker } = fakeDeps({ rec: plan({ expiresAt: NOW - 1 }) });
    const result = await orders.executeRecommendation(
      { userId, recommendationId: "1", volume: 0.1, idempotencyKey: "k-expired" },
      deps,
    );
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "recommendation_expired");
    assert.equal(broker.sends.length, 0);
  });

  it("refuses a plan still awaiting activation — no resting orders, no auto-fill later", async () => {
    const { deps, broker } = fakeDeps({
      rec: plan({ executionState: "awaiting_activation", status: "pending_entry" }),
    });
    const result = await orders.executeRecommendation(
      { userId, recommendationId: "1", volume: 0.1, idempotencyKey: "k-await" },
      deps,
    );
    assert.equal((result as { code: string }).code, "awaiting_activation");
    assert.equal(broker.sends.length, 0);
  });

  it("refuses a closed recommendation by its outcome", async () => {
    const { deps } = fakeDeps({ rec: plan({ outcome: "win_tp1" }) });
    const result = await orders.executeRecommendation(
      { userId, recommendationId: "1", volume: 0.1, idempotencyKey: "k-closed" },
      deps,
    );
    assert.equal((result as { code: string }).code, "recommendation_closed");
  });

  it("refuses a size beyond free margin with the short factual reason", async () => {
    const { deps, broker } = fakeDeps({ rec: plan(), freeMargin: 500 });
    // 10 lots × 100 oz × ~4000 / 100 leverage = ~40,000 margin ≫ 500 free.
    const result = await orders.executeRecommendation(
      { userId, recommendationId: "1", volume: 10, idempotencyKey: "k-margin" },
      deps,
    );
    assert.equal((result as { code: string }).code, "insufficient_margin");
    assert.equal(broker.sends.length, 0, "an impossible size never reaches the broker");
  });

  it("refuses an off-grid volume before any HTTP", async () => {
    const { deps, broker } = fakeDeps({ rec: plan() });
    const result = await orders.executeRecommendation(
      { userId, recommendationId: "1", volume: 0.255, idempotencyKey: "k-grid" },
      deps,
    );
    assert.equal((result as { code: string }).code, "invalid_volume");
    assert.equal(broker.sends.length, 0);
  });
});

describe("the press itself", () => {
  it("executes once, with the stop in the order, and records the full ledger row", async () => {
    const rec = plan();
    const { deps, broker } = fakeDeps({ rec });
    const result = await orders.executeRecommendation(
      { userId, recommendationId: rec.id, volume: 0.25, idempotencyKey: "k-happy" },
      deps,
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(broker.sends.length, 1);
    assert.equal(broker.sends[0]!.stopLoss, 3990, "SL rode in the same request");
    assert.equal(broker.sends[0]!.takeProfit, 4015, "TP1 rode along");

    const row = result.execution;
    assert.equal(row.state, "filled");
    assert.equal(row.user_id, userId);
    assert.equal(row.recommendation_id, rec.canonicalId);
    assert.equal(row.metaapi_account_id, "acct-1");
    assert.equal(row.volume, 0.25);
    assert.equal(row.requested_price, 4000.2);
    assert.equal(row.executed_price, 4000.4);
    assert.equal(row.slippage, 0.2);
    assert.equal(row.broker_position_id, "pos-1");
  });

  it("same key pressed twice → one order", async () => {
    const rec = plan();
    const { deps, broker } = fakeDeps({ rec });
    const first = await orders.executeRecommendation(
      { userId, recommendationId: rec.id, volume: 0.1, idempotencyKey: "k-dup" },
      deps,
    );
    const second = await orders.executeRecommendation(
      { userId, recommendationId: rec.id, volume: 0.1, idempotencyKey: "k-dup" },
      deps,
    );
    assert.ok(first.ok);
    assert.equal(broker.sends.length, 1, "the second press sent nothing");
    assert.ok(second.ok, "the duplicate press is answered with the SAME filled order");
    assert.equal(second.execution.id, first.execution.id);
  });

  it("a different key while the first order is live → already_executed, nothing sent", async () => {
    const rec = plan();
    const { deps, broker } = fakeDeps({ rec });
    const first = await orders.executeRecommendation(
      { userId, recommendationId: rec.id, volume: 0.1, idempotencyKey: "k-a" },
      deps,
    );
    assert.ok(first.ok);
    const second = await orders.executeRecommendation(
      { userId, recommendationId: rec.id, volume: 0.2, idempotencyKey: "k-b" },
      deps,
    );
    assert.equal(second.ok, false);
    assert.equal((second as { code: string }).code, "already_executed");
    assert.equal(broker.sends.length, 1);
  });
});

describe("disconnect after send — reconcile, never guess", () => {
  it("lost response + broker HAS the order → filled from the broker's own numbers, no resend", async () => {
    const rec = plan();
    const { deps, broker } = fakeDeps({ rec });
    broker.sendImpl = async () => {
      throw new tradeMod.MetaapiTradeError(504, "send_unconfirmed", "socket dropped");
    };
    const result = await orders.executeRecommendation(
      { userId, recommendationId: rec.id, volume: 0.1, idempotencyKey: "k-lost-found" },
      deps,
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.execution.state, "filled");
    assert.equal(result.execution.executed_price, 4000.4);
    assert.equal(broker.sends.length, 1, "reconciliation never resends");
    assert.ok(broker.lookups >= 1, "the broker was ASKED, not assumed");
  });

  it("lost response + broker has NOTHING → failed by name, and only then may a fresh press send", async () => {
    const rec = plan();
    const { deps, broker } = fakeDeps({ rec });
    broker.lookup = { position: null, deal: null };
    broker.sendImpl = async () => {
      throw new tradeMod.MetaapiTradeError(504, "send_unconfirmed", "socket dropped");
    };
    const first = await orders.executeRecommendation(
      { userId, recommendationId: rec.id, volume: 0.1, idempotencyKey: "k-lost-absent" },
      deps,
    );
    assert.equal(first.ok, false);
    assert.equal((first as { code: string }).code, "send_unconfirmed");
    const settled = await storeMod.getExecutionByKey(userId, "k-lost-absent");
    assert.equal(settled?.state, "failed");
    assert.equal(settled?.error_code, "send_unconfirmed_absent");

    // The plan is free again — a NEW press with a new key sends exactly once.
    broker.sendImpl = async () => doneResponse();
    broker.lookup = fakeDeps({ rec }).broker.lookup;
    const retry = await orders.executeRecommendation(
      { userId, recommendationId: rec.id, volume: 0.1, idempotencyKey: "k-retry" },
      deps,
    );
    assert.ok(retry.ok, JSON.stringify(retry));
    assert.equal(broker.sends.length, 2, "one failed-absent attempt + one real order");
  });

  it("a broker rejection is recorded with its short code", async () => {
    const rec = plan();
    const { deps } = fakeDeps({ rec });
    const { broker } = { broker: undefined as never };
    void broker;
    const rejecting = fakeDeps({ rec });
    rejecting.broker.sendImpl = async () => ({
      ok: false,
      numericCode: 10019,
      stringCode: "TRADE_RETCODE_NO_MONEY",
      orderId: null,
      positionId: null,
      message: "not enough money",
    });
    void deps;
    const result = await orders.executeRecommendation(
      { userId, recommendationId: rec.id, volume: 0.1, idempotencyKey: "k-reject" },
      rejecting.deps,
    );
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "insufficient_margin");
    const row = await storeMod.getExecutionByKey(userId, "k-reject");
    assert.equal(row?.state, "rejected");
  });
});

describe("execution context (feeds the modal and the button)", () => {
  it("unlinked → linked:false and nothing executable", async () => {
    const { deps } = fakeDeps({ rec: plan(), linked: false });
    const context = await orders.buildExecutionContext(userId, "1", deps);
    assert.equal(context.linked, false);
    assert.equal(context.executable, false);
    assert.equal(context.refusal, "not_linked");
  });

  it("linked + valid plan → precomputed size from the user's own risk setting", async () => {
    const rec = plan();
    const { deps } = fakeDeps({ rec });
    const context = await orders.buildExecutionContext(userId, rec.id, deps);
    assert.equal(context.linked, true);
    assert.equal(context.executable, true);
    assert.equal(context.suggestedVolume, 0.1);
    assert.equal(context.balance, 10_000);
    assert.equal(context.stopLoss, 3990);
    assert.equal(context.volumeStep, 0.01);
  });

  it("linked + expired plan → named refusal in the context too", async () => {
    const { deps } = fakeDeps({ rec: plan({ expiresAt: NOW - 1 }) });
    const context = await orders.buildExecutionContext(userId, "1", deps);
    assert.equal(context.executable, false);
    assert.equal(context.refusal, "recommendation_expired");
  });
});
