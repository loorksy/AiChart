/**
 * The create_recommendation contract over a REAL MCP transport.
 *
 * The -32602 storm did not come from the handler — it came from the layers in
 * front of it: the SDK validating arguments against the ADVERTISED schema, and
 * clients flattening a nested anyOf[oneOf[...]] union into contradicting error
 * paths. So these tests exercise the same layers: a linked client/server pair,
 * tools/list for what is actually advertised, and tools/call for what actually
 * passes. Unit tests on the zod object alone cannot catch an advertised-schema
 * regression; this file exists so that class of drift fails CI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BridgeClient } from "../../bridge/client.js";
import { loadConfig } from "../../config.js";
import { createAiChartMcpServer } from "../../server/mcpServer.js";

process.env.MCP_AUTH_MODE = "none";

/** The complete non-activation layers every BUY/SELL payload needs. */
const completePlan = {
  symbol: "XAUUSD",
  action: "buy",
  rationale: "Demand zone held twice and the higher timeframe agrees.",
  factors: ["demand zone", "htf alignment"],
  entry: 3996,
  stop_loss: 3992,
  take_profit: 4030,
  timeframe: "15m",
  invalidation_rule: "A full 15m close below 3992 kills the idea.",
  alternative_scenario: "Losing 3992 flips the bias toward 3980.",
  validity_candles: 24,
};

async function withClient<T>(
  fn: (client: Client, calls: unknown[]) => Promise<T>,
): Promise<T> {
  const cfg = loadConfig();
  cfg.authMode = "none";
  const bridge = BridgeClient.forUser(cfg, "probe@test.local");
  // Capture what would reach the web API instead of calling it.
  const calls: unknown[] = [];
  (bridge as unknown as { post: (path: string, body: unknown) => Promise<unknown> }).post =
    async (path: string, body: unknown) => {
      calls.push({ path, body });
      return { ok: true, data: { id: 1 } };
    };
  const server = createAiChartMcpServer(bridge);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "contract-audit", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await fn(client, calls);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("advertised activation_rule schema", () => {
  it("is ONE flat union keyed on kind — never a nested anyOf[oneOf[...]]", async () => {
    await withClient(async (client) => {
      const tools = await client.listTools();
      const tool = tools.tools.find((t) => t.name === "create_recommendation");
      assert.ok(tool, "create_recommendation must be advertised");
      const rule = (tool.inputSchema.properties as Record<string, unknown>)
        .activation_rule as Record<string, unknown>;
      assert.ok(rule, "activation_rule must be advertised");
      // Flatten one wrapper level: the generator may emit the 7 kind branches
      // directly, or group them in a single oneOf beside the string variant.
      // Both are const-keyed and fine; DEEPER nesting is the regression.
      const top = (rule.anyOf ?? rule.oneOf) as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(top), "the union must be a branch list");
      const branches = top.flatMap((entry) =>
        Array.isArray(entry.oneOf)
          ? (entry.oneOf as Array<Record<string, unknown>>)
          : Array.isArray(entry.anyOf)
            ? (entry.anyOf as Array<Record<string, unknown>>)
            : [entry],
      );
      // 7 rule kinds + exactly ONE string branch (stale-cached-schema clients
      // serialize the rule as JSON text; it is decoded and re-validated by the
      // same strict schema in the handler).
      assert.equal(branches.length, 8, "seven kinds + the string compatibility variant");
      const stringBranches = branches.filter((b) => b.type === "string");
      assert.equal(stringBranches.length, 1, "exactly one string variant");
      const objectBranches = branches.filter((b) => b.type === "object");
      assert.equal(objectBranches.length, 7);
      for (const branch of objectBranches) {
        const kind = (branch.properties as Record<string, { const?: string }>).kind;
        assert.ok(kind?.const, "every object branch names its kind as a const");
        // The nested-union regression, stated as the thing that must not return.
        assert.ok(!branch.anyOf && !branch.oneOf, "no branch hides another union");
      }
      const kinds = objectBranches.map(
        (b) => (b.properties as Record<string, { const?: string }>).kind.const,
      );
      assert.ok(kinds.includes("composite"), "composite is a sibling, not a wrapper");
    });
  });

  it("does not require timeframe or price_touch.direction — the measured traps", async () => {
    await withClient(async (client) => {
      const tools = await client.listTools();
      const tool = tools.tools.find((t) => t.name === "create_recommendation")!;
      const rule = (tool.inputSchema.properties as Record<string, unknown>)
        .activation_rule as { anyOf?: Array<Record<string, unknown>> };
      const flat = (rule.anyOf ?? []).flatMap((entry: Record<string, unknown>) =>
        Array.isArray(entry.oneOf) ? (entry.oneOf as Array<Record<string, unknown>>) : [entry],
      );
      for (const branch of flat) {
        if (branch.type !== "object") continue;
        const required = (branch.required ?? []) as string[];
        assert.ok(!required.includes("timeframe"), "timeframe must be optional");
        const kind = (branch.properties as Record<string, { const?: string }>).kind
          .const;
        if (kind === "price_touch") {
          assert.ok(!required.includes("direction"), "touch direction is optional");
        }
      }
    });
  });
});

describe("tools/call through the SDK validation layer", () => {
  it("accepts the EXACT composite the platform model emitted on 2026-07-28", async () => {
    // Verbatim incident shape: price_touch leaf with no direction, no timeframe.
    await withClient(async (client, calls) => {
      const result = await client.callTool({
        name: "create_recommendation",
        arguments: {
          ...completePlan,
          plan_type: "conditional",
          activation_condition:
            "Price returns to the demand zone and a 15m candle closes above 4000.",
          activation_rule: {
            kind: "composite",
            operator: "all",
            rules: [
              { kind: "price_touch", level: 4000 },
              { kind: "candle_close_above", level: 4000, timeframe: "15m" },
            ],
          },
        },
      });
      assert.notEqual(result.isError, true, JSON.stringify(result.content).slice(0, 300));
      assert.equal(calls.length, 1, "exactly one bridge POST for one tool call");
    });
  });

  it("accepts a minimal conditional close rule with no timeframe", async () => {
    await withClient(async (client, calls) => {
      const result = await client.callTool({
        name: "create_recommendation",
        arguments: {
          ...completePlan,
          plan_type: "conditional",
          activation_condition: "A candle closes above 4005 on the plan timeframe.",
          activation_rule: { kind: "candle_close_above", level: 4005 },
        },
      });
      assert.notEqual(result.isError, true, JSON.stringify(result.content).slice(0, 300));
      assert.equal(calls.length, 1);
    });
  });

  it("accepts an immediate plan with no activation at all", async () => {
    await withClient(async (client, calls) => {
      const result = await client.callTool({
        name: "create_recommendation",
        arguments: { ...completePlan, plan_type: "immediate" },
      });
      assert.notEqual(result.isError, true, JSON.stringify(result.content).slice(0, 300));
      assert.equal(calls.length, 1);
    });
  });

  it("still refuses a conditional plan without its activation pair — with a short, fixable message", async () => {
    await withClient(async (client, calls) => {
      const result = await client.callTool({
        name: "create_recommendation",
        arguments: { ...completePlan, plan_type: "conditional" },
      });
      assert.equal(result.isError, true);
      const text = JSON.stringify(result.content);
      assert.match(text, /activation_condition/);
      assert.match(text, /activation_rule/);
      // The fix instruction rides along; the wall of union paths does not.
      assert.match(text, /Fix ONLY the fields above/);
      assert.equal(calls.length, 0, "nothing reaches the web API on refusal");
    });
  });

  it("refuses an ungradable rule kind without writing anything", async () => {
    await withClient(async (client, calls) => {
      const result = await client.callTool({
        name: "create_recommendation",
        arguments: {
          ...completePlan,
          plan_type: "conditional",
          activation_condition: "Some stated trigger for the plan.",
          activation_rule: { kind: "teleport", level: 4000 },
        },
      });
      assert.equal(result.isError, true);
      assert.equal(calls.length, 0);
    });
  });
});

describe("stale-client transport compatibility", () => {
  it("accepts the plan-contract fields serialized as STRINGS — the measured Claude-connector behaviour", async () => {
    await withClient(async (client, calls) => {
      const result = await client.callTool({
        name: "create_recommendation",
        arguments: {
          ...completePlan,
          plan_type: "conditional",
          activation_condition: "Return to 4053.31 and reject it upward on a 15m close.",
          // Exactly what a connector with a cached pre-contract schema sends.
          activation_rule: JSON.stringify({ kind: "rejection_confirmed", level: 4053.31, direction: "above" }),
          validity_candles: "32" as unknown as number,
        },
      });
      assert.notEqual(result.isError, true, JSON.stringify(result.content).slice(0, 300));
      assert.equal(calls.length, 1);
      // The web API receives TYPED canonical values, never the wire strings.
      const forwarded = (calls[0] as { body: Record<string, unknown> }).body;
      assert.equal(typeof forwarded.activation_rule, "object");
      assert.equal((forwarded.activation_rule as { kind?: string }).kind, "rejection_confirmed");
      assert.equal(forwarded.validity_candles, 32);
    });
  });

  it("a string rule is validated by the SAME strict schema — garbage still refused", async () => {
    await withClient(async (client, calls) => {
      const bad = await client.callTool({
        name: "create_recommendation",
        arguments: {
          ...completePlan,
          plan_type: "conditional",
          activation_condition: "Some stated trigger for the plan.",
          activation_rule: JSON.stringify({ kind: "teleport", level: 1 }),
        },
      });
      assert.equal(bad.isError, true);
      const notJson = await client.callTool({
        name: "create_recommendation",
        arguments: {
          ...completePlan,
          plan_type: "conditional",
          activation_condition: "Some stated trigger for the plan.",
          activation_rule: "not json at all",
        },
      });
      assert.equal(notJson.isError, true);
      assert.equal(calls.length, 0, "neither refusal reached the web API");
    });
  });
});
