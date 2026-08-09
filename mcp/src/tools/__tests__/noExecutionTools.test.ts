/**
 * THE QUANT GROUP CANNOT EXECUTE. Ever.
 *
 * QuantDinger's own MCP surface (`mcp_server/src/quantdinger_mcp/server.py`,
 * `MCP_TOOL_NAMES`) ships `place_quick_order`, `stop_strategy`,
 * `emergency_stop_trading` and `cancel_open_paper_orders`. AiChart's Quant
 * Agent deliberately ports none of them: it is an analysis engine with its own
 * isolated store, and the single highest-consequence way this port could go
 * wrong is a future edit that adds an execute verb to it because the upstream
 * had one (risk E.4 in the port plan).
 *
 * A comment saying so is not a guard. This file is, and it checks the property
 * four independent ways, because any one of them alone is defeatable:
 *
 *   1. NAME — no quant tool is named with an execution verb.
 *   2. INPUT — no quant tool accepts an order-shaped field (lots, ticket…).
 *   3. RISK CLASS — no quant tool is contract-classed "execution".
 *   4. REACH — the quant handlers only ever call `/api/quant-agent/*`, so even
 *      a tool with an innocent name cannot POST to the execution routes.
 *
 * (4) is the one that actually holds the line: names and schemas are what an
 * author controls, but a URL is what the server acts on.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TOOL_CATALOG } from "../schemas/index.js";

interface ContractTool {
  name: string;
  riskClass: string;
  permission: string;
}

function loadContract(): { tools: ContractTool[] } {
  return JSON.parse(
    readFileSync(join(process.cwd(), "..", "agent", "tools", "contract.json"), "utf8"),
  );
}

/** The quant group = every tool in the `quantAgent` domain, both catalog files. */
const QUANT_TOOLS = TOOL_CATALOG.filter((t) => t.domain === "quantAgent");

/** Source files that register a quant-group handler. */
const QUANT_HANDLER_FILES = ["quantAgent.ts", "quantAnalysis.ts"];

/**
 * Execution verbs, matched as whole underscore-separated NAME TOKENS so
 * `quant_agent_list_recommendations` is not flagged for containing "commend".
 * Upstream's four execution tool names all trip this list.
 */
const EXECUTION_TOKENS = new Set([
  "open",
  "close",
  "place",
  "execute",
  "exec",
  "submit",
  "cancel",
  "modify",
  "order",
  "orders",
  "buy",
  "sell",
  "trade",
  "trades",
  "position",
  "positions",
  "broker",
  "liquidate",
  "withdraw",
  "deposit",
  "transfer",
  "stop",
  "emergency",
]);

/** Order-shaped inputs. A quant tool that took one of these would be sizing a trade. */
const EXECUTION_FIELDS = [
  "lot",
  "lots",
  "volume",
  "ticket",
  "order_id",
  "orderId",
  "order_type",
  "orderType",
  "side",
  "trade_id",
  "tradeId",
  "account_id",
  "accountId",
  "take_profit",
  "takeProfit",
  "stop_loss",
  "stopLoss",
  "position_size",
  "positionSize",
];

/**
 * The handler source with comments removed.
 *
 * Both quant handler files DISCUSS the execution routes in their headers —
 * naming what they must never reach is the point of those comments — so a
 * naive text scan would fail on the prose that documents the rule. Only
 * executable text is inspected; the `checked >= 10` floor below proves the
 * stripping did not also eat the code it is meant to inspect.
 *
 * Line comments are dropped only when the line IS a comment, so a `//` inside
 * a URL in real code can never be stripped away.
 */
function readHandlerCode(file: string): string {
  return readFileSync(join(process.cwd(), "src", "tools", file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

describe("the quant group contains no execution-shaped tool", () => {
  it("has quant tools at all (a passing guard over an empty set proves nothing)", () => {
    assert.ok(QUANT_TOOLS.length >= 10, `expected >=10 quant tools, got ${QUANT_TOOLS.length}`);
  });

  it("1. no quant tool NAME carries an execution verb", () => {
    for (const tool of QUANT_TOOLS) {
      for (const token of tool.name.split("_")) {
        assert.ok(
          !EXECUTION_TOKENS.has(token),
          `${tool.name}: "${token}" is an execution verb — the quant group may never place, close, cancel, or size an order`,
        );
      }
    }
  });

  it("1b. upstream's own execution tool names would be caught by that check", () => {
    // Guards the guard: if EXECUTION_TOKENS is ever gutted, this fails first.
    for (const upstream of [
      "quant_agent_place_quick_order",
      "quant_agent_stop_strategy",
      "quant_agent_emergency_stop_trading",
      "quant_agent_cancel_open_paper_orders",
    ]) {
      assert.ok(
        upstream.split("_").some((token) => EXECUTION_TOKENS.has(token)),
        `${upstream} must be caught by the name guard`,
      );
    }
  });

  it("2. no quant tool accepts an order-shaped input field", () => {
    for (const tool of QUANT_TOOLS) {
      for (const field of Object.keys(tool.inputSchema)) {
        assert.ok(
          !EXECUTION_FIELDS.includes(field),
          `${tool.name}: input field "${field}" is order-shaped`,
        );
      }
    }
  });

  it("3. no quant tool is contract-classed as execution", () => {
    const byName = new Map(loadContract().tools.map((t) => [t.name, t]));
    for (const tool of QUANT_TOOLS) {
      const entry = byName.get(tool.name);
      assert.ok(entry, `${tool.name} missing from agent/tools/contract.json`);
      assert.notEqual(entry.riskClass, "execution", tool.name);
      assert.ok(
        entry.permission.startsWith("quant_agent."),
        `${tool.name}: permission ${entry.permission} must stay inside the quant_agent.* namespace, never trade.*`,
      );
    }
  });

  it("4. quant handlers only ever reach /api/quant-agent/* — no execution route is addressable", () => {
    // Every string literal path handed to bridge.get/post/patch/delete, plus
    // every template literal, in the two quant handler files.
    const pathPattern = /["'`](\/api\/[^"'`$]*)/g;
    let checked = 0;
    for (const file of QUANT_HANDLER_FILES) {
      const source = readHandlerCode(file);
      for (const match of source.matchAll(pathPattern)) {
        const path = match[1]!;
        checked += 1;
        assert.ok(
          path.startsWith("/api/quant-agent/"),
          `${file}: reaches ${path} — the quant group must stay inside /api/quant-agent/`,
        );
      }
    }
    assert.ok(checked >= 10, `expected to inspect >=10 bridge paths, saw ${checked}`);
  });

  it("4b. quant handlers never name an execution tool or route", () => {
    for (const file of QUANT_HANDLER_FILES) {
      const source = readHandlerCode(file);
      for (const forbidden of [
        "/api/agent/trade",
        "/api/agent/mt5",
        "open_trade",
        "close_trade",
        "close_partial",
        "modify_sl_tp",
        "cancel_mt5_order",
        "respond_approval",
        "executionSafety",
      ]) {
        assert.ok(
          !source.includes(forbidden),
          `src/tools/${file} must not reference ${forbidden}`,
        );
      }
    }
  });

  it("no quant tool returns a raw renderable bar series", () => {
    // The OANDA analysis feed is analysis-only: derived scores may cross this
    // boundary, plottable candles may not (that is how the chart-surface leak
    // happened before — see web/src/lib/candles/__tests__/analysisIsolation.test.ts).
    // No quant tool takes a candle-count/range argument, and none names itself
    // after bars, because nothing here is allowed to hand back a series.
    const CANDLE_FIELDS = ["bars", "candles", "ohlc", "count", "from", "to", "since", "date_range"];
    for (const tool of QUANT_TOOLS) {
      for (const field of Object.keys(tool.inputSchema)) {
        assert.ok(
          !CANDLE_FIELDS.includes(field),
          `${tool.name}: "${field}" is a bar-series argument — quant tools return derived analysis only`,
        );
      }
      for (const token of tool.name.split("_")) {
        assert.ok(
          !["bars", "candles", "ohlc", "klines"].includes(token),
          `${tool.name} is named after a bar series`,
        );
      }
    }
  });
});
