import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CHART_TRADE_ALLOWED_ENDPOINT } from "../ChartBuySellTicket";

/**
 * Chart buy/sell is an APPROVAL surface, never an EXECUTION surface.
 * Same line as mcp/src/ui/__tests__/cardButtons.test.ts: a control that can
 * place an order without an explicit human confirmation step is wrong.
 */
const FORBIDDEN = [
  "/api/agent/trade/open",
  "/api/agent/trade/close",
  "open_trade",
  "close_trade",
  "executeIntent",
] as const;

describe("ChartBuySellTicket approval-only contract", () => {
  const source = readFileSync(
    path.join(__dirname, "../ChartBuySellTicket.tsx"),
    "utf8",
  );

  it("only allows the request-approval endpoint", () => {
    assert.equal(CHART_TRADE_ALLOWED_ENDPOINT, "/api/trades/request-approval");
    assert.match(source, /\/api\/trades\/request-approval/);
    // A single fetch target — no second trading URL hiding beside it.
    const fetches = source.match(/fetch\s*\(/g) ?? [];
    assert.equal(fetches.length, 1);
  });

  it("never references execution endpoints", () => {
    for (const forbidden of FORBIDDEN) {
      assert.equal(
        source.includes(forbidden),
        false,
        `chart ticket must not mention ${forbidden}`,
      );
    }
  });

  it("session route creates approvals, not orders", () => {
    const route = readFileSync(
      path.join(
        __dirname,
        "../../../app/api/trades/request-approval/route.ts",
      ),
      "utf8",
    );
    assert.match(route, /createApprovalRequest/);
    for (const forbidden of FORBIDDEN) {
      assert.equal(
        route.includes(forbidden),
        false,
        `request-approval route must not mention ${forbidden}`,
      );
    }
  });
});
