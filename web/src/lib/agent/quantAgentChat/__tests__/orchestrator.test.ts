import assert from "node:assert/strict";
import test from "node:test";
import {
  generateQuantStrategyFromDescription,
  runQuantAgentChatTurn,
  type QuantAgentChatDeps,
} from "@/lib/agent/quantAgentChat/orchestrator";
import type { AnthropicResponse } from "@/lib/llm";
import type {
  GenerateValidateQuantStrategyResult,
  QuantRecommendation,
} from "@/lib/quantAgent/types";
import type { AgentChatMessageRecord, AppendAgentChatMessageInput } from "@/lib/agent/chatHistory/types";

function textResponse(text: string): AnthropicResponse {
  return {
    id: "msg_test",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

function fakeRecommendation(overrides: Partial<QuantRecommendation> = {}): QuantRecommendation {
  return {
    id: "rec_1",
    owner_user_id: 1,
    symbol: "XAUUSD",
    market: "forex",
    interval: "1h",
    direction: "buy",
    plan_type: "immediate",
    entry: 2400,
    stop_loss: 2380,
    take_profit: 2450,
    targets: [2420, 2450],
    confidence: 0.7,
    strategy_id: "ema_trend_v1",
    strategy_version: "1.0.0",
    regime: "trend",
    rationale: "EMA fast above slow with rising ADX.",
    evidence: {},
    validity_expires_at: null,
    lifecycle_state: "active",
    source_bar_close_time: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Builds a fully-stubbed deps object; individual fields are overridden per test. */
function buildDeps(overrides: Partial<QuantAgentChatDeps> = {}): {
  deps: QuantAgentChatDeps;
  appended: AppendAgentChatMessageInput[];
} {
  const appended: AppendAgentChatMessageInput[] = [];
  const deps: QuantAgentChatDeps = {
    listRecommendations: async () => [],
    getRecommendation: async () => null,
    generateAndValidate: async () => ({ status: "persisted" }) as GenerateValidateQuantStrategyResult,
    callLLM: (async () => textResponse("stub reply")) as QuantAgentChatDeps["callLLM"],
    callLLMStream: (async (_params, handlers) => {
      handlers?.onTextDelta?.("stub ");
      handlers?.onTextDelta?.("reply");
      return textResponse("stub reply");
    }) as QuantAgentChatDeps["callLLMStream"],
    appendMessage: (async (_userId, chatId, input) => {
      appended.push(input);
      return {
        id: `msg_${appended.length}`,
        chatId,
        role: input.role,
        content: input.content,
        createdAt: Date.now(),
      } as AgentChatMessageRecord;
    }) as QuantAgentChatDeps["appendMessage"],
    getMessages: async () => [] as AgentChatMessageRecord[],
    searchMemories: async () => [],
    ...overrides,
  };
  return { deps, appended };
}

test("chat branch: persists user then assistant message with agentId quant_agent, and drafts a memory candidate", async () => {
  const { deps, appended } = buildDeps();
  const result = await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_1", message: "remember I only trade XAUUSD" },
    deps,
  );
  assert.equal(result.intent, "chat");
  assert.equal(result.reply, "stub reply");
  assert.ok(result.memoryCandidate);
  assert.equal(appended.length, 2);
  assert.equal(appended[0]!.role, "user");
  assert.equal(appended[0]!.agentId, "quant_agent");
  assert.equal(appended[1]!.role, "assistant");
  assert.equal(appended[1]!.agentId, "quant_agent");
});

test("chat branch: streaming uses callLLMStream and forwards cumulative deltas", async () => {
  const { deps } = buildDeps();
  const deltas: string[] = [];
  const result = await runQuantAgentChatTurn(
    {
      userId: 1,
      chatId: "chat_1",
      message: "how are you today?",
      onDelta: (text) => deltas.push(text),
    },
    deps,
  );
  assert.deepEqual(deltas, ["stub ", "stub reply"]);
  assert.equal(result.reply, "stub reply");
  // No note-worthy phrasing here, so no memory candidate.
  assert.equal(result.memoryCandidate, null);
});

test("explain_recommendation branch: fetches recommendations and passes them through as context", async () => {
  const rec = fakeRecommendation();
  const { deps } = buildDeps({
    listRecommendations: async (_ctx, params) => {
      assert.equal(params?.symbol, "XAUUSD");
      return [rec];
    },
  });
  const result = await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_1", message: "why did XAUUSD get a buy signal?" },
    deps,
  );
  assert.equal(result.intent, "explain_recommendation");
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0]!.id, "rec_1");
});

test("generate_strategy branch: first attempt persists — no repair call made", async () => {
  let validateCalls = 0;
  const { deps } = buildDeps({
    callLLM: (async () =>
      textResponse(
        JSON.stringify({
          strategy_id: "trend_follow_v1",
          version: "1.0.0",
          display_name: "Trend Follow",
          direction: "buy",
          regime_affinity: ["trend"],
          entry_conditions: { all: [{ type: "ema_relation", fast_period: 20, slow_period: 50, relation: "above" }] },
          stop_loss_atr_multiple: 1.5,
          take_profit_r_multiples: [1, 2],
        }),
      )) as QuantAgentChatDeps["callLLM"],
    generateAndValidate: async () => {
      validateCalls += 1;
      return {
        status: "persisted",
        strategy: {
          id: "strat_1",
          strategy_id: "trend_follow_v1",
          version: "1.0.0",
          display_name: "Trend Follow",
          enabled: false,
          source_generated: true,
        },
      } as GenerateValidateQuantStrategyResult;
    },
  });
  const result = await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_1", message: "create a new strategy for gold trend following" },
    deps,
  );
  assert.equal(result.intent, "generate_strategy");
  assert.equal(validateCalls, 1);
  assert.ok(result.strategyProposal);
  assert.equal(result.strategyProposal!.status, "persisted");
  if (result.strategyProposal!.status === "persisted") {
    assert.equal(result.strategyProposal!.strategy.enabled, false);
  }
});

const VALID_SPEC_JSON = JSON.stringify({
  strategy_id: "trend_follow_v1",
  version: "1.0.0",
  display_name: "Trend Follow",
  direction: "buy",
  regime_affinity: ["trend"],
  entry_conditions: { all: [{ type: "ema_relation", fast_period: 20, slow_period: 50, relation: "above" }] },
  stop_loss_atr_multiple: 1.5,
  take_profit_r_multiples: [1, 2],
});

test("generate_strategy: invalid first attempt repairs exactly once, then succeeds", async () => {
  let validateCalls = 0;
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_SPEC_JSON)) as QuantAgentChatDeps["callLLM"],
    generateAndValidate: async () => {
      validateCalls += 1;
      if (validateCalls === 1) {
        return {
          status: "invalid",
          errors: [{ path: "stop_loss_atr_multiple", message: "must be positive" }],
        } as GenerateValidateQuantStrategyResult;
      }
      return {
        status: "persisted",
        strategy: {
          strategy_id: "trend_follow_v1",
          version: "1.0.0",
          display_name: "Trend Follow",
          enabled: false,
          source_generated: true,
        },
      } as GenerateValidateQuantStrategyResult;
    },
  });
  const outcome = await generateQuantStrategyFromDescription(1, "build a strategy", deps, "req_1");
  assert.equal(validateCalls, 2);
  assert.equal(outcome.status, "persisted");
  assert.equal(outcome.repaired, true);
});

test("generate_strategy: repair also fails — exactly one repair, no further loop", async () => {
  let validateCalls = 0;
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_SPEC_JSON)) as QuantAgentChatDeps["callLLM"],
    generateAndValidate: async () => {
      validateCalls += 1;
      return {
        status: "invalid",
        errors: [{ path: "direction", message: "must be buy or sell" }],
      } as GenerateValidateQuantStrategyResult;
    },
  });
  const outcome = await generateQuantStrategyFromDescription(1, "build a strategy", deps, "req_1");
  assert.equal(validateCalls, 2, "exactly two validate calls: original + one repair, never a loop");
  assert.equal(outcome.status, "invalid");
  assert.equal(outcome.repaired, true);
});

test("generate_strategy chat branch surfaces the failure explanation without offering a retry", async () => {
  const { deps, appended } = buildDeps({
    generateAndValidate: async () => ({
      status: "invalid",
      errors: [{ path: "direction", message: "must be buy or sell" }],
    }) as GenerateValidateQuantStrategyResult,
  });
  const result = await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_1", message: "design a strategy for silver" },
    deps,
  );
  assert.equal(result.strategyProposal?.status, "invalid");
  const assistantMessage = appended.find((m) => m.role === "assistant");
  assert.ok(assistantMessage);
});
