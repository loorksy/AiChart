/**
 * Phase 1 requirement (MCP upgrade brief): every bucket-A tool's `dry_run`
 * must commit nothing, asserted by test — not just "believed to" from reading
 * the source. 4 of the 7 tools write to this DB, so their tests call the REAL
 * route handler against a real temp-sqlite DB and assert row counts /
 * statuses are unchanged — a regression that moved the dry_run short-circuit
 * after a write would show up here, not just in code review.
 *
 * modify_sl_tp / cancel_mt5_order / close_partial write nothing to THIS DB
 * even on a real call — they call the broker directly (tradeManagementDispatch.ts)
 * and, on an unreachable/unsupported backend, degrade to a same-shape
 * `{ok:false,...}` JSON response rather than throwing, so there is no HTTP
 * status or DB row to diff against. Their tests instead assert the response
 * shape their dry_run branch promises (`preview_available:false`) AND a
 * static regression guard: the dry_run branch's `return` must appear in the
 * route source BEFORE the line that calls the broker dispatch function — the
 * same source-position-invariant style already used by
 * executionAuthorizationPaths.test.ts in this repo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { NextRequest } from "next/server";

const dir = mkdtempSync(join(tmpdir(), "aichart-bucket-a-dry-run-"));
process.env.DB_PATH = join(dir, "bucket-a.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "bucket-a-dry-run-test-secret";
process.env.AICHART_SERVICE_TOKEN = "bucket-a-dry-run-test-token-1234567890";
process.env.AICHART_SINGLE_USER = "1";
// resolveBrokerForMarket needs a resolvable backend; the value is never
// dialled — every dry_run path returns before any bridge/broker call.
process.env.FOREX_BACKEND = "mt5local";
process.env.MT5_BRIDGE_URL = "http://127.0.0.1:1";
delete process.env.DATABASE_URL;
delete process.env.AICHART_AGENT_USER_ID;

let userId = 0;

function bridgeRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.AICHART_SERVICE_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

async function countRows(table: string): Promise<number> {
  const db = await import("@/lib/db");
  const row = (await db.queryOne(`SELECT COUNT(*) as n FROM ${table}`)) as { n: number };
  return Number(row.n);
}

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["bucket-a-dry-run@example.com", "x", "admin", "active"],
  );
  // A connected, funded account: satisfies getRiskBudget (equity > 0) and
  // isAutoExecutionAuthorized (connected + auto mode) for open_trade/request_approval.
  await db.execute(
    `INSERT INTO mt_accounts
       (user_id, platform, server, login, password_enc, metaapi_account_id,
        state, connection_status, balance, equity, currency, account_trade_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [userId, "mt5", "Bucket-A-Server", "1000", "enc", "acct-bucket-a", "DEPLOYED", "CONNECTED", 1000, 1000, "USD", "demo"],
  );
  const { ensureUserDefaults } = await import("@/lib/store");
  await ensureUserDefaults(userId);
  const { setTradeMode } = await import("@/lib/agent/tradeMode");
  await setTradeMode({ userId, mode: "auto", actor: "platform" });
});

describe("open_trade dry_run commits nothing", () => {
  it("returns a preview without writing an intent or a trade", async () => {
    const { POST } = await import("../trade/open/route");
    const intentsBefore = await countRows("trade_intents");
    const tradesBefore = await countRows("trades");

    const res = await POST(
      bridgeRequest("/api/agent/trade/open", {
        symbol: "EURUSD",
        side: "buy",
        stop_loss: 1.05,
        confidence: 80,
        rationale: "dry_run no-write regression test",
        dry_run: true,
      }),
    );
    const body = await res.json();

    assert.equal(body.data?.dry_run ?? body.dry_run, true);
    assert.equal(await countRows("trade_intents"), intentsBefore, "must not create an intent");
    assert.equal(await countRows("trades"), tradesBefore, "must not create a trade");
  });
});

describe("close_trade dry_run commits nothing", () => {
  it("previews the close without changing the trade's status", async () => {
    const { recordTrade } = await import("@/lib/store");
    const trade = await recordTrade(userId, {
      symbol: "EURUSD",
      side: "buy",
      qty: 1000,
      quote_qty: 1000,
      avg_price: 1.05,
      env: "demo",
      market: "forex",
      broker: "mt5_local",
      status: "open",
    });

    const { POST } = await import("../trade/close/route");
    const res = await POST(
      bridgeRequest("/api/agent/trade/close", { trade_id: trade.id, dry_run: true }),
    );
    const body = await res.json();

    assert.equal(body.dry_run, true);
    const { getTrade } = await import("@/lib/store");
    const after = await getTrade(userId, trade.id);
    assert.equal(after?.status, "open", "must not close the trade");
  });
});

describe("request_approval dry_run commits nothing", () => {
  it("previews the card without creating a pending intent", async () => {
    const { POST } = await import("../approval/request/route");
    const before_ = await countRows("trade_intents");

    const res = await POST(
      bridgeRequest("/api/agent/approval/request", {
        symbol: "EURUSD",
        side: "buy",
        stop_loss: 1.05,
        dry_run: true,
      }),
    );
    const body = await res.json();

    assert.equal(body.dry_run, true);
    assert.equal(await countRows("trade_intents"), before_, "must not create a pending intent");
  });
});

describe("respond_approval dry_run commits nothing", () => {
  it("previews the pending intent without resolving it", async () => {
    const { createIntent } = await import("@/lib/store");
    const intent = await createIntent(userId, {
      recommendation_id: null,
      authorization_source: "user_approved",
      symbol: "EURUSD",
      side: "buy",
      notional: 100,
      market: "forex",
      broker: "mt5_local",
      entry: 1.05,
      stop_loss: 1.04,
      take_profit: 1.07,
      status: "pending",
      rationale: "dry_run no-write regression test",
    });

    const { POST } = await import("../approval/respond/route");
    const res = await POST(
      bridgeRequest("/api/agent/approval/respond", {
        intent_id: intent.id,
        action: "approve",
        dry_run: true,
      }),
    );
    const body = await res.json();

    assert.equal(body.dry_run, true);
    const { getIntent } = await import("@/lib/store");
    const after = await getIntent(intent.id, userId);
    assert.equal(after?.status, "pending", "must not resolve the intent");
  });
});

/**
 * These 3 have no DB row and no reachable broker to diff against in a unit
 * test — even a "real" call degrades to a same-shape `{ok:false,...}` JSON
 * response on an unsupported/unreachable backend (tradeManagementDispatch.ts),
 * so there is no HTTP status or row count that distinguishes "sent" from
 * "not sent." Two checks stand in: the dry_run response's own promised shape,
 * and a static source-order guard proving the dry_run branch's `return`
 * appears before the line that calls the broker dispatch function — so a
 * regression that reordered them would fail this test even though it can't
 * be caught by observing an HTTP response.
 */
describe("modify_sl_tp / cancel_mt5_order / close_partial dry_run never reaches the broker", () => {
  it("modify_sl_tp: dry_run returns preview_available:false and nothing is sent", async () => {
    const { POST } = await import("../mt/modify-sl-tp/route");
    const preview = await POST(
      bridgeRequest("/api/agent/mt/modify-sl-tp", { ticket: 1, stop_loss: 1.05, dry_run: true }),
    );
    const previewBody = await preview.json();
    assert.equal(previewBody.ok, true);
    assert.equal(previewBody.dry_run, true);
    assert.equal(previewBody.preview_available, false);
  });

  it("cancel_mt5_order: dry_run returns preview_available:false and nothing is sent", async () => {
    const { POST } = await import("../mt/cancel-order/route");
    const preview = await POST(
      bridgeRequest("/api/agent/mt/cancel-order", { ticket: 1, dry_run: true }),
    );
    const previewBody = await preview.json();
    assert.equal(previewBody.ok, true);
    assert.equal(previewBody.dry_run, true);
    assert.equal(previewBody.preview_available, false);
  });

  it("close_partial: dry_run returns preview_available:false and nothing is sent", async () => {
    const { POST } = await import("../mt/close-partial/route");
    const preview = await POST(
      bridgeRequest("/api/agent/mt/close-partial", { ticket: 1, lots: 0.1, dry_run: true }),
    );
    const previewBody = await preview.json();
    assert.equal(previewBody.ok, true);
    assert.equal(previewBody.dry_run, true);
    assert.equal(previewBody.preview_available, false);
  });

  const DISPATCH_CALL: Record<string, string> = {
    "app/api/agent/mt/modify-sl-tp/route.ts": "modifyStopsForUser(",
    "app/api/agent/mt/cancel-order/route.ts": "cancelOrderForUser(",
    "app/api/agent/mt/close-partial/route.ts": "closePartiallyForUser(",
  };

  for (const [relPath, dispatchCall] of Object.entries(DISPATCH_CALL)) {
    it(`${relPath}: dry_run short-circuit precedes ${dispatchCall}`, () => {
      const src = readFileSync(join(process.cwd(), "src", relPath), "utf8");
      const dryRunIdx = src.indexOf("if (body.dry_run)");
      const dispatchIdx = src.indexOf(dispatchCall);
      assert.ok(dryRunIdx >= 0, `${relPath} must have an "if (body.dry_run)" branch`);
      assert.ok(dispatchIdx >= 0, `${relPath} must call ${dispatchCall}`);
      assert.ok(
        dryRunIdx < dispatchIdx,
        `${relPath}: the dry_run branch must appear (and return) before the call to ${dispatchCall}`,
      );
      const between = src.slice(dryRunIdx, dispatchIdx);
      assert.match(
        between,
        /return /,
        `${relPath}: the dry_run branch must return before reaching ${dispatchCall}`,
      );
    });
  }
});
