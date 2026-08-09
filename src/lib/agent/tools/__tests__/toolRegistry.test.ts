import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  activeRecommendationReadTool,
  AgentToolExecutor,
  AgentToolRegistry,
  createCommonToolMcpAdapter,
  marketSnapshotTool,
  redactedPreview,
  type AgentToolDefinition,
  type AgentToolExecutionContext,
  type AgentToolTelemetryEvent,
} from "..";

function context(overrides: Partial<AgentToolExecutionContext> = {}): AgentToolExecutionContext {
  return {
    requestId: "r1", userId: 7,
    permissions: new Set(["market.read", "recommendation.read"]),
    featureFlags: new Set(), providers: new Set(["market_data"]), calledTools: new Set(),
    ...overrides,
  };
}

test("registers tools in stable order and rejects duplicates", () => {
  const registry = new AgentToolRegistry();
  registry.register(marketSnapshotTool(async () => ({ ok: true })));
  registry.register(activeRecommendationReadTool(async () => null));
  assert.deepEqual(registry.list().map(({ name }) => name), ["active_recommendation_read", "market_snapshot"]);
  assert.throws(() => registry.register(marketSnapshotTool(async () => ({}))), /Duplicate/);
});

test("validates input, output, permissions and provider availability", async () => {
  const registry = new AgentToolRegistry();
  registry.register(marketSnapshotTool(async () => ({ price: 1 })));
  const executor = new AgentToolExecutor(registry);
  assert.equal((await executor.execute("missing", context(), {})).error?.code, "TOOL_NOT_FOUND");
  assert.equal((await executor.execute("market_snapshot", context(), { symbol: "X", timeframe: "15m" })).error?.code, "TOOL_INPUT_INVALID");
  assert.equal((await executor.execute("market_snapshot", context({ permissions: new Set() }), { symbol: "XAUUSD", timeframe: "15m" })).error?.code, "TOOL_PERMISSION_DENIED");
  assert.equal((await executor.execute("market_snapshot", context({ providers: new Set() }), { symbol: "XAUUSD", timeframe: "15m" })).error?.code, "TOOL_UNAVAILABLE");
});

test("enforces feature flags and output schema", async () => {
  const registry = new AgentToolRegistry();
  const definition: AgentToolDefinition<{ value: string }, { count: number }> = {
    name: "flagged_read", version: "1.0.0", description: "flagged",
    inputSchema: z.object({ value: z.string() }), outputSchema: z.object({ count: z.number() }),
    readOnly: true, repeatable: true, timeoutMs: 100, permission: "market.read",
    riskClass: "read", costClass: "low", requiredFeatureFlags: ["FLAG"],
    available: () => true, execute: async () => ({ count: "bad" } as unknown as { count: number }),
  };
  registry.register(definition);
  const executor = new AgentToolExecutor(registry);
  assert.equal((await executor.execute("flagged_read", context(), { value: "x" })).error?.code, "TOOL_UNAVAILABLE");
  assert.equal((await executor.execute("flagged_read", context({ featureFlags: new Set(["FLAG"]) }), { value: "x" })).error?.code, "TOOL_OUTPUT_INVALID");
});

test("normalizes timeout and AbortSignal cancellation", async () => {
  const registry = new AgentToolRegistry();
  const slow: AgentToolDefinition<Record<string, never>, string> = {
    name: "slow_read", version: "1.0.0", description: "slow", inputSchema: z.object({}), outputSchema: z.string(),
    readOnly: true, repeatable: true, timeoutMs: 20, permission: "market.read", riskClass: "read", costClass: "low",
    available: () => true, execute: async () => new Promise((resolve) => setTimeout(() => resolve("ok"), 100)),
  };
  registry.register(slow);
  const executor = new AgentToolExecutor(registry);
  assert.equal((await executor.execute("slow_read", context(), {})).error?.code, "TOOL_TIMEOUT");
  const controller = new AbortController();
  controller.abort();
  assert.equal((await executor.execute("slow_read", context({ signal: controller.signal }), {})).error?.code, "TOOL_ABORTED");
});

test("normalizes provider/internal errors without returning stacks", async () => {
  const registry = new AgentToolRegistry();
  registry.register(activeRecommendationReadTool(async () => { throw new Error("upstream provider secret stack"); }));
  const result = await new AgentToolExecutor(registry).execute("active_recommendation_read", context(), {});
  assert.equal(result.error?.code, "TOOL_PROVIDER_ERROR");
  assert.doesNotMatch(result.error?.message ?? "", /secret stack/);
});

test("redacts secrets and emits bounded telemetry", async () => {
  const events: AgentToolTelemetryEvent[] = [];
  const registry = new AgentToolRegistry();
  registry.register(activeRecommendationReadTool(async () => ({ token: "Bearer abcdefghijklmnop" })));
  const executor = new AgentToolExecutor(registry, (event) => { events.push(event); });
  const result = await executor.execute("active_recommendation_read", context(), { symbol: "XAUUSD" });
  assert.equal(result.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.length, 1);
  assert.doesNotMatch(events[0]!.outputPreview ?? "", /abcdefghijklmnop/);
  assert.doesNotMatch(redactedPreview("-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----"), /PRIVATE KEY/);
});

test("enforces non-repeatable policy and idempotency hook", async () => {
  const registry = new AgentToolRegistry();
  const definition: AgentToolDefinition<{ id: string }, { id: string }> = {
    name: "single_read", version: "1.0.0", description: "single", inputSchema: z.object({ id: z.string() }), outputSchema: z.object({ id: z.string() }),
    readOnly: true, repeatable: false, timeoutMs: 100, permission: "market.read", riskClass: "read", costClass: "low",
    available: () => true, idempotencyKey: (_context, input) => input.id, execute: async (_context, input) => input,
  };
  registry.register(definition);
  const calledTools = new Set<string>();
  const ctx = context({ calledTools, idempotencyLookup: async () => undefined, idempotencyStore: async () => {} });
  assert.equal((await new AgentToolExecutor(registry).execute("single_read", ctx, { id: "x" })).ok, true);
  assert.equal((await new AgentToolExecutor(registry).execute("single_read", ctx, { id: "x" })).error?.code, "TOOL_PERMISSION_DENIED");
});

test("read-only MCP adapter preserves schema and permission parity", async () => {
  const registry = new AgentToolRegistry();
  registry.register(marketSnapshotTool(async () => ({ fresh: true })));
  const executor = new AgentToolExecutor(registry);
  const adapter = createCommonToolMcpAdapter(registry, executor);
  assert.equal(adapter.list()[0]?.permission, registry.get("market_snapshot")?.permission);
  const result = await adapter.call("market_snapshot", context(), { symbol: "XAUUSD", timeframe: "15m" });
  assert.equal(result.ok, true);
});
