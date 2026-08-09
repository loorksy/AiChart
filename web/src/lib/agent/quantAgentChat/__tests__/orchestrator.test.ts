import assert from "node:assert/strict";
import test from "node:test";
import {
  generateAndBacktestQuantStrategyCodeFromDescription,
  generateQuantStrategyCodeFromDescription,
  runQuantAgentChatTurn,
  type QuantAgentChatDeps,
} from "@/lib/agent/quantAgentChat/orchestrator";
import type { AnthropicResponse } from "@/lib/llm";
import type {
  GenerateValidateQuantStrategyResult,
  QuantBacktestResult,
  QuantRecommendation,
} from "@/lib/quantAgent/types";
import type {
  AgentChatMessageRecord,
  AgentChatSession,
  AppendAgentChatMessageInput,
} from "@/lib/agent/chatHistory/types";

/** A backtest result that clears every confirmed quality-gate threshold. */
function passingBacktestResult(): QuantBacktestResult {
  return {
    status: "completed",
    metrics: {
      tradeCount: 40,
      winRate: 0.55,
      profitFactor: 1.8,
      expectancyR: 0.3,
      maxDrawdownR: -4,
      maxDrawdownPercent: 12,
      sharpeR: 1.1,
      metricReasons: {},
    },
    warnings: null,
    error: null,
  };
}

/** A backtest result that fails the trade-count threshold (well below 30). */
function failingBacktestResult(): QuantBacktestResult {
  return {
    status: "completed",
    metrics: {
      tradeCount: 5,
      winRate: 0.4,
      profitFactor: 0.9,
      expectancyR: -0.1,
      maxDrawdownR: -8,
      maxDrawdownPercent: 55,
      sharpeR: -0.2,
      metricReasons: {},
    },
    warnings: null,
    error: null,
  };
}

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

/**
 * Builds a fully-stubbed deps object; individual fields are overridden per
 * test. `getChat`/`setPendingTask` share a simple in-memory Map keyed by
 * chatId — enough to actually persist the Composer Coach wizard's
 * `pendingTask` between sequential `runQuantAgentChatTurn` calls, the same
 * way the real `chatStore` does across real HTTP requests.
 */
function buildDeps(overrides: Partial<QuantAgentChatDeps> = {}): {
  deps: QuantAgentChatDeps;
  appended: AppendAgentChatMessageInput[];
  pendingTasks: Map<string, unknown>;
} {
  const appended: AppendAgentChatMessageInput[] = [];
  const pendingTasks = new Map<string, unknown>();
  const deps: QuantAgentChatDeps = {
    listRecommendations: async () => [],
    getRecommendation: async () => null,
    generateAndValidate: async () => ({ status: "persisted" }) as GenerateValidateQuantStrategyResult,
    generateAndValidateCode: async () => ({ status: "persisted" }) as GenerateValidateQuantStrategyResult,
    // Defaults CLEAR the quality gate on round 1 — most orchestrator-level
    // tests care about the wizard/turn plumbing, not the backtest loop
    // itself (that gets its own dedicated tests below), so the default keeps
    // `generateAndValidateCode` calls at exactly 1 unless a test overrides.
    backtestQuantStrategy: async () => passingBacktestResult(),
    setStrategyStatus: async () => ({ strategy: { strategy_id: "s", version: "1", display_name: "s", enabled: true, source_generated: true } }),
    fetchAnalysisBars: async ({ symbol, interval }) => ({
      symbol,
      market: "forex" as const,
      interval: interval ?? "1h",
      bars: [],
    }),
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
    getChat: (async (_userId, chatId, agentId) =>
      ({
        id: chatId,
        userId: 1,
        agentId,
        title: "chat",
        language: "ar",
        createdAt: 0,
        updatedAt: 0,
        pendingTask: pendingTasks.get(chatId) ?? null,
      }) as AgentChatSession) as QuantAgentChatDeps["getChat"],
    setPendingTask: (async (_userId, chatId, _agentId, task) => {
      if (task === null) pendingTasks.delete(chatId);
      else pendingTasks.set(chatId, task);
      return null;
    }) as QuantAgentChatDeps["setPendingTask"],
    ...overrides,
  };
  return { deps, appended, pendingTasks };
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

test("explain_recommendation branch: prefers the explicitly passed symbol over the regex hint from the message", async () => {
  const rec = fakeRecommendation({ symbol: "EURUSD" });
  const { deps } = buildDeps({
    listRecommendations: async (_ctx, params) => {
      assert.equal(params?.symbol, "EURUSD");
      return [rec];
    },
  });
  const result = await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_1", message: "why did XAUUSD get a buy signal?", symbol: "EURUSD" },
    deps,
  );
  assert.equal(result.intent, "explain_recommendation");
  assert.equal(result.recommendations[0]!.symbol, "EURUSD");
});

test("explain_recommendation branch: full recommendation objects (not just ids) are persisted on the assistant message", async () => {
  const rec = fakeRecommendation();
  const { deps, appended } = buildDeps({
    listRecommendations: async () => [rec],
  });
  await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_1", message: "why did XAUUSD get a buy signal?" },
    deps,
  );
  const assistantMessage = appended.find((m) => m.role === "assistant");
  const stored = assistantMessage?.result as { recommendations?: QuantRecommendation[] } | undefined;
  assert.ok(stored?.recommendations);
  assert.equal(stored.recommendations!.length, 1);
  assert.equal(stored.recommendations![0]!.id, "rec_1");
  assert.equal(stored.recommendations![0]!.entry, 2400);
});

test("appends the selected symbol onto both the user and assistant messages when provided", async () => {
  const { deps, appended } = buildDeps();
  await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_1", message: "how are you today?", symbol: "GBPUSD" },
    deps,
  );
  assert.equal(appended[0]!.symbol, "GBPUSD");
  assert.equal(appended[1]!.symbol, "GBPUSD");
});

// Chat's generate_strategy intent now defaults to the sandboxed-code path
// (plan §4: technical parity with QuantDinger) — `callLLM` is expected to
// return a fenced Python code block (the `evaluate(features)` body), not a
// JSON spec, and `generateAndValidateCode` (not `generateAndValidate`) is
// the validation hook exercised below.
//
// As of Feature B (Composer Coach), the `generate_strategy` intent no longer
// generates immediately from one message — it starts a 4-step guided wizard
// (direction → regime → entry/exit → confirm) and only runs the (unmodified)
// sandboxed-code pipeline once step 4 is confirmed. The tests below drive
// that wizard through sequential `runQuantAgentChatTurn` calls against the
// SAME chatId, sharing `buildDeps()`'s in-memory `pendingTasks` map exactly
// like the real chatStore persists `pending_task_json` between requests.

const VALID_EVALUATE_CODE = "```python\ndef evaluate(features):\n    return None\n```";

/** Drives the wizard through steps 1-3, leaving it parked at step 4 (confirm). */
async function driveWizardToConfirm(
  deps: QuantAgentChatDeps,
  chatId: string,
): Promise<Awaited<ReturnType<typeof runQuantAgentChatTurn>>[]> {
  const turns: Awaited<ReturnType<typeof runQuantAgentChatTurn>>[] = [];
  turns.push(
    await runQuantAgentChatTurn({ userId: 1, chatId, message: "create a new strategy for gold trend following" }, deps),
  );
  turns.push(await runQuantAgentChatTurn({ userId: 1, chatId, message: "Buy only" }, deps));
  turns.push(await runQuantAgentChatTurn({ userId: 1, chatId, message: "Trending" }, deps));
  turns.push(
    await runQuantAgentChatTurn(
      { userId: 1, chatId, message: "Enter when EMA20 crosses above EMA50 and RSI is above 50." },
      deps,
    ),
  );
  return turns;
}

test("generate_strategy: starting the wizard does NOT generate anything yet — step 1 question + suggestions only", async () => {
  const { deps } = buildDeps();
  const result = await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_1", message: "create a new strategy for gold trend following" },
    deps,
  );
  assert.equal(result.intent, "generate_strategy");
  assert.equal(result.strategyProposal, null, "no strategy is generated by starting the wizard");
  assert.ok(result.composerCoach, "step 1 carries a composerCoach payload");
  assert.equal(result.composerCoach!.suggestions.length, 3, "step 1 offers 3 direction chips");
  assert.equal(result.composerCoach!.ready, false);
});

test("generate_strategy: steps 2 and 3 advance the wizard without generating", async () => {
  const { deps } = buildDeps();
  const chatId = "chat_steps";
  await runQuantAgentChatTurn({ userId: 1, chatId, message: "build a new strategy" }, deps);
  const afterStep1 = await runQuantAgentChatTurn({ userId: 1, chatId, message: "Sell only" }, deps);
  assert.equal(afterStep1.composerCoach!.suggestions.length, 4, "step 2 offers 4 regime chips");
  assert.equal(afterStep1.strategyProposal, null);

  const afterStep2 = await runQuantAgentChatTurn({ userId: 1, chatId, message: "Ranging" }, deps);
  assert.equal(afterStep2.composerCoach!.suggestions.length, 0, "step 3 offers no clickable chips");
  assert.equal(afterStep2.strategyProposal, null);

  const afterStep3 = await runQuantAgentChatTurn(
    { userId: 1, chatId, message: "Enter on a Bollinger lower-band touch, exit at the mid band." },
    deps,
  );
  assert.equal(afterStep3.composerCoach!.ready, true, "step 4 (confirm) is marked ready");
  assert.equal(afterStep3.strategyProposal, null, "still no generation before confirmation");
});

test("generate_strategy: confirming step 4 runs the EXISTING sandboxed-code pipeline exactly once — no repair call made", async () => {
  let validateCalls = 0;
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_EVALUATE_CODE)) as QuantAgentChatDeps["callLLM"],
    generateAndValidateCode: async (_ctx, params) => {
      validateCalls += 1;
      assert.equal(params.code, "def evaluate(features):\n    return None");
      return {
        status: "persisted",
        strategy: {
          id: "strat_1",
          strategy_id: params.strategyId,
          version: params.version,
          display_name: params.displayName,
          enabled: false,
          source_generated: true,
          generation_mode: "sandboxed_code",
          source_code: params.code,
        },
      } as GenerateValidateQuantStrategyResult;
    },
  });
  const chatId = "chat_confirm";
  await driveWizardToConfirm(deps, chatId);
  const confirmed = await runQuantAgentChatTurn({ userId: 1, chatId, message: "generate" }, deps);

  assert.equal(confirmed.intent, "generate_strategy");
  assert.equal(validateCalls, 1);
  assert.equal(confirmed.composerCoach, null, "the wizard payload is gone once generation actually ran");
  assert.ok(confirmed.strategyProposal);
  assert.equal(confirmed.strategyProposal!.status, "persisted");
  if (confirmed.strategyProposal!.status === "persisted") {
    assert.equal(confirmed.strategyProposal!.mode, "sandboxed_code");
    assert.equal(confirmed.strategyProposal!.strategy.enabled, false);
    if (confirmed.strategyProposal!.mode === "sandboxed_code") {
      assert.match(confirmed.strategyProposal!.code, /def evaluate\(features\)/);
    }
  }
});

test("generate_strategy: the exact synthesized description (built from the 3 collected fields) reaches the LLM call", async () => {
  let capturedDescription = "";
  const { deps } = buildDeps({
    callLLM: (async (params) => {
      const userTurn = params.messages.find((m) => m.role === "user");
      const match = /for: ([\s\S]+)$/.exec(String(userTurn?.content ?? ""));
      if (match) capturedDescription = match[1]!.trim();
      return textResponse(VALID_EVALUATE_CODE);
    }) as QuantAgentChatDeps["callLLM"],
  });
  const chatId = "chat_synth";
  await runQuantAgentChatTurn({ userId: 1, chatId, message: "create a new strategy" }, deps);
  await runQuantAgentChatTurn({ userId: 1, chatId, message: "Buy only" }, deps);
  await runQuantAgentChatTurn({ userId: 1, chatId, message: "Trending" }, deps);
  await runQuantAgentChatTurn(
    { userId: 1, chatId, message: "Enter when EMA20 crosses above EMA50." },
    deps,
  );
  await runQuantAgentChatTurn({ userId: 1, chatId, message: "generate" }, deps);

  assert.equal(
    capturedDescription,
    "A buy-only strategy suited for trending markets. Entry/exit logic: Enter when EMA20 crosses above EMA50.",
  );
});

test("generate_strategy: cancelling mid-flow clears the wizard, and a fresh generate_strategy message starts a NEW wizard at step 1 (not a resume)", async () => {
  const { deps, pendingTasks } = buildDeps();
  const chatId = "chat_cancel";
  await runQuantAgentChatTurn({ userId: 1, chatId, message: "create a new strategy" }, deps);
  await runQuantAgentChatTurn({ userId: 1, chatId, message: "Buy only" }, deps);
  assert.ok(pendingTasks.get(chatId), "wizard is in progress at step 2");

  const cancelled = await runQuantAgentChatTurn({ userId: 1, chatId, message: "cancel" }, deps);
  assert.equal(cancelled.composerCoach, null, "cancellation clears the composerCoach payload");
  assert.equal(cancelled.strategyProposal, null, "cancellation never generates anything");
  assert.equal(pendingTasks.get(chatId), undefined, "pendingTask is cleared from storage");

  // Arabic cancel keyword works the same way, case-insensitive/trimmed.
  await runQuantAgentChatTurn({ userId: 1, chatId, message: "create a new strategy" }, deps);
  const cancelledAr = await runQuantAgentChatTurn({ userId: 1, chatId, message: "  إلغاء  " }, deps);
  assert.equal(cancelledAr.composerCoach, null);
  assert.equal(pendingTasks.get(chatId), undefined);

  // A brand-new generate_strategy message afterward starts fresh at step 1.
  const restarted = await runQuantAgentChatTurn({ userId: 1, chatId, message: "build a new strategy" }, deps);
  assert.equal(restarted.composerCoach!.suggestions.length, 3, "back at step 1's direction chips");
  const restartedTask = pendingTasks.get(chatId) as { step: number; collected: Record<string, unknown> };
  assert.equal(restartedTask.step, 1);
  assert.deepEqual(restartedTask.collected, {}, "nothing carried over from the cancelled wizard");
});

test("generate_strategy: invalid first attempt repairs exactly once, then succeeds", async () => {
  let validateCalls = 0;
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_EVALUATE_CODE)) as QuantAgentChatDeps["callLLM"],
    generateAndValidateCode: async (_ctx, params) => {
      validateCalls += 1;
      if (validateCalls === 1) {
        return {
          status: "invalid",
          errors: [{ path: "code", message: "stop_loss_atr_multiple must be positive" }],
        } as GenerateValidateQuantStrategyResult;
      }
      return {
        status: "persisted",
        strategy: {
          strategy_id: params.strategyId,
          version: params.version,
          display_name: params.displayName,
          enabled: false,
          source_generated: true,
          generation_mode: "sandboxed_code",
          source_code: params.code,
        },
      } as GenerateValidateQuantStrategyResult;
    },
  });
  const outcome = await generateQuantStrategyCodeFromDescription(1, "build a strategy", deps, "req_1");
  assert.equal(validateCalls, 2);
  assert.equal(outcome.status, "persisted");
  assert.equal(outcome.mode, "sandboxed_code");
  assert.equal(outcome.repaired, true);
});

test("generate_strategy: repair also fails — exactly one repair, no further loop", async () => {
  let validateCalls = 0;
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_EVALUATE_CODE)) as QuantAgentChatDeps["callLLM"],
    generateAndValidateCode: async () => {
      validateCalls += 1;
      return {
        status: "invalid",
        errors: [{ path: "code", message: "disallowed import: os" }],
      } as GenerateValidateQuantStrategyResult;
    },
  });
  const outcome = await generateQuantStrategyCodeFromDescription(1, "build a strategy", deps, "req_1");
  assert.equal(validateCalls, 2, "exactly two validate calls: original + one repair, never a loop");
  assert.equal(outcome.status, "invalid");
  assert.equal(outcome.mode, "sandboxed_code");
  assert.equal(outcome.repaired, true);
});

test("generate_strategy chat branch surfaces the failure explanation without offering a retry, once step 4 is confirmed", async () => {
  const { deps, appended } = buildDeps({
    callLLM: (async () => textResponse(VALID_EVALUATE_CODE)) as QuantAgentChatDeps["callLLM"],
    generateAndValidateCode: async () => ({
      status: "invalid",
      errors: [{ path: "code", message: "disallowed import: os" }],
    }) as GenerateValidateQuantStrategyResult,
  });
  const chatId = "chat_fail";
  await driveWizardToConfirm(deps, chatId);
  const confirmed = await runQuantAgentChatTurn({ userId: 1, chatId, message: "generate" }, deps);

  assert.equal(confirmed.strategyProposal?.status, "invalid");
  assert.equal(confirmed.composerCoach, null);
  const lastAssistantMessage = [...appended].reverse().find((m) => m.role === "assistant");
  assert.ok(lastAssistantMessage);
});

test("generate_strategy: a Lonora session (agentId lonora) is never touched by the Composer Coach wizard/pendingTask logic", async () => {
  // Sanity check: `runQuantAgentChatTurn`/the intent router/pendingTask logic
  // in THIS module only ever operate on agentId "quant_agent" — every
  // `getChat`/`setPendingTask`/`appendMessage` call the orchestrator makes is
  // hardcoded to "quant_agent" (see orchestrator.ts), so a Lonora chat's
  // pendingTask can never be read or written through this code path at all.
  const { deps, pendingTasks } = buildDeps({
    getChat: (async (_userId, chatId, agentId) => {
      assert.equal(agentId, "quant_agent", "orchestrator must never read a Lonora-scoped chat");
      return {
        id: chatId,
        userId: 1,
        agentId,
        title: "chat",
        language: "ar",
        createdAt: 0,
        updatedAt: 0,
        pendingTask: pendingTasks.get(chatId) ?? null,
      } as AgentChatSession;
    }) as QuantAgentChatDeps["getChat"],
    setPendingTask: (async (_userId, chatId, agentId, task) => {
      assert.equal(agentId, "quant_agent", "orchestrator must never write a Lonora-scoped chat");
      if (task === null) pendingTasks.delete(chatId);
      else pendingTasks.set(chatId, task);
      return null;
    }) as QuantAgentChatDeps["setPendingTask"],
  });
  const result = await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_lonora_isolation", message: "create a new strategy" },
    deps,
  );
  assert.equal(result.intent, "generate_strategy");
  assert.ok(result.composerCoach);
});

test("appends the selected interval onto both the user and assistant messages when provided", async () => {
  const { deps, appended } = buildDeps();
  await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_1", message: "how are you today?", symbol: "GBPUSD", interval: "4h" },
    deps,
  );
  assert.equal(appended[0]!.interval, "4h");
  assert.equal(appended[1]!.interval, "4h");
});

// --- Bounded backtest quality-gate loop (plan §4/§5) ---
//
// `generateAndBacktestQuantStrategyCodeFromDescription` wraps (never
// replaces) `generateQuantStrategyCodeFromDescription`'s own safety pipeline.
// Tested directly here (bypassing the wizard) so each scenario is isolated;
// the wizard-integration test further below checks the wiring end to end.

test("backtest gate: round 1 safety failure stops immediately — backtest is NEVER called on an unsafe draft", async () => {
  let backtestCalls = 0;
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_EVALUATE_CODE)) as QuantAgentChatDeps["callLLM"],
    generateAndValidateCode: async () =>
      ({
        status: "invalid",
        errors: [{ path: "code", message: "disallowed import: os" }],
      }) as GenerateValidateQuantStrategyResult,
    backtestQuantStrategy: async () => {
      backtestCalls += 1;
      return passingBacktestResult();
    },
  });
  const outcome = await generateAndBacktestQuantStrategyCodeFromDescription(
    1,
    "build a strategy",
    "EURUSD",
    "forex",
    "1h",
    deps,
    "req_1",
  );
  assert.equal(backtestCalls, 0, "an unsafe/invalid draft must never be backtested");
  assert.equal(outcome.passedGate, false);
  assert.equal(outcome.roundsUsed, 0);
  assert.equal(outcome.backtest, null);
  assert.equal(outcome.generation.status, "invalid");
});

test("backtest gate: round 1 clears the quality bar — stops after exactly 1 round, no quality-repair call", async () => {
  let validateCalls = 0;
  let backtestCalls = 0;
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_EVALUATE_CODE)) as QuantAgentChatDeps["callLLM"],
    generateAndValidateCode: async (_ctx, params) => {
      validateCalls += 1;
      return {
        status: "persisted",
        strategy: {
          strategy_id: params.strategyId,
          version: params.version,
          display_name: params.displayName,
          enabled: false,
          source_generated: true,
          generation_mode: "sandboxed_code",
          source_code: params.code,
        },
      } as GenerateValidateQuantStrategyResult;
    },
    backtestQuantStrategy: async () => {
      backtestCalls += 1;
      return passingBacktestResult();
    },
  });
  const outcome = await generateAndBacktestQuantStrategyCodeFromDescription(
    1,
    "build a strategy",
    "EURUSD",
    "forex",
    "1h",
    deps,
    "req_1",
  );
  assert.equal(validateCalls, 1, "only round 1's own safety validation ran — no quality-repair round needed");
  assert.equal(backtestCalls, 1);
  assert.equal(outcome.passedGate, true);
  assert.equal(outcome.roundsUsed, 1);
  assert.ok(outcome.backtest);
  assert.equal(outcome.generation.status, "persisted");
});

test("backtest gate: a null profit_factor/max_drawdown_percent never counts as a pass — exhausts all 3 rounds, returns the last honest failing metrics", async () => {
  let validateCalls = 0;
  let backtestCalls = 0;
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_EVALUATE_CODE)) as QuantAgentChatDeps["callLLM"],
    generateAndValidateCode: async (_ctx, params) => {
      validateCalls += 1;
      return {
        status: "persisted",
        strategy: {
          strategy_id: params.strategyId,
          version: params.version,
          display_name: params.displayName,
          enabled: false,
          source_generated: true,
          generation_mode: "sandboxed_code",
          source_code: params.code,
        },
      } as GenerateValidateQuantStrategyResult;
    },
    backtestQuantStrategy: async () => {
      backtestCalls += 1;
      return {
        status: "completed",
        metrics: {
          tradeCount: 40, // clears the trade-count bar on its own
          winRate: 0.5,
          profitFactor: null, // explicitly null — must never be treated as a pass
          expectancyR: null,
          maxDrawdownR: null,
          maxDrawdownPercent: null,
          sharpeR: null,
          metricReasons: { profit_factor: "no losing trades in the sample" },
        },
        warnings: null,
        error: null,
      } as QuantBacktestResult;
    },
  });
  const outcome = await generateAndBacktestQuantStrategyCodeFromDescription(
    1,
    "build a strategy",
    "EURUSD",
    "forex",
    "1h",
    deps,
    "req_1",
  );
  assert.equal(backtestCalls, 3, "exactly 3 backtest rounds — initial + 2 refinements, never more");
  assert.equal(validateCalls, 3, "round 1 + 2 quality-repair re-validations");
  assert.equal(outcome.passedGate, false, "a null profit_factor must never pass the gate");
  assert.equal(outcome.roundsUsed, 3);
  assert.ok(outcome.backtest, "the last (failing) backtest result is still returned, never discarded");
  assert.equal(outcome.backtest!.metrics!.profitFactor, null);
  assert.equal(outcome.generation.status, "persisted", "the last safety-valid persisted strategy is still returned");
});

test("backtest gate: fails round 1, passes round 2 — stops early with exactly one quality-repair round", async () => {
  let validateCalls = 0;
  let backtestCalls = 0;
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_EVALUATE_CODE)) as QuantAgentChatDeps["callLLM"],
    generateAndValidateCode: async (_ctx, params) => {
      validateCalls += 1;
      return {
        status: "persisted",
        strategy: {
          strategy_id: params.strategyId,
          version: params.version,
          display_name: params.displayName,
          enabled: false,
          source_generated: true,
          generation_mode: "sandboxed_code",
          source_code: params.code,
        },
      } as GenerateValidateQuantStrategyResult;
    },
    backtestQuantStrategy: async () => {
      backtestCalls += 1;
      return backtestCalls === 1 ? failingBacktestResult() : passingBacktestResult();
    },
  });
  const outcome = await generateAndBacktestQuantStrategyCodeFromDescription(
    1,
    "build a strategy",
    "EURUSD",
    "forex",
    "1h",
    deps,
    "req_1",
  );
  assert.equal(backtestCalls, 2);
  assert.equal(validateCalls, 2, "round 1 + exactly one quality-repair re-validation");
  assert.equal(outcome.passedGate, true);
  assert.equal(outcome.roundsUsed, 2);
});

test("backtest gate: interim progress callback fires at each phase transition, localized", async () => {
  const progress: string[] = [];
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_EVALUATE_CODE)) as QuantAgentChatDeps["callLLM"],
    generateAndValidateCode: async (_ctx, params) =>
      ({
        status: "persisted",
        strategy: {
          strategy_id: params.strategyId,
          version: params.version,
          display_name: params.displayName,
          enabled: false,
          source_generated: true,
          generation_mode: "sandboxed_code",
          source_code: params.code,
        },
      }) as GenerateValidateQuantStrategyResult,
    backtestQuantStrategy: async () => passingBacktestResult(),
  });
  await generateAndBacktestQuantStrategyCodeFromDescription(
    1,
    "build a strategy",
    "EURUSD",
    "forex",
    "1h",
    deps,
    "req_1",
    (status) => progress.push(status),
    "en",
  );
  assert.deepEqual(progress, ["Drafting and validating the strategy...", "Testing round 1 of 3..."]);
});

test("generate_strategy wizard confirm: threads the chat's symbol/interval into the backtest loop and attaches real metrics to the proposal", async () => {
  let capturedBarsOptions: { symbol: string; interval?: string; market?: string } | null = null;
  let capturedBacktestParams: { strategyId: string; symbol: string; interval: string; market: string } | null = null;
  const { deps } = buildDeps({
    callLLM: (async () => textResponse(VALID_EVALUATE_CODE)) as QuantAgentChatDeps["callLLM"],
    generateAndValidateCode: async (_ctx, params) =>
      ({
        status: "persisted",
        strategy: {
          strategy_id: params.strategyId,
          version: params.version,
          display_name: params.displayName,
          enabled: false,
          source_generated: true,
          generation_mode: "sandboxed_code",
          source_code: params.code,
        },
      }) as GenerateValidateQuantStrategyResult,
    fetchAnalysisBars: async (options) => {
      capturedBarsOptions = { symbol: options.symbol, interval: options.interval, market: options.market };
      return { symbol: options.symbol, market: "forex" as const, interval: options.interval ?? "1h", bars: [] };
    },
    backtestQuantStrategy: async (_ctx, params) => {
      capturedBacktestParams = {
        strategyId: params.strategyId,
        symbol: params.symbol,
        interval: params.interval,
        market: params.market,
      };
      return passingBacktestResult();
    },
  });
  const chatId = "chat_interval";
  await driveWizardToConfirm(deps, chatId);
  const confirmed = await runQuantAgentChatTurn(
    { userId: 1, chatId, message: "generate", symbol: "GBPUSD", interval: "4h" },
    deps,
  );

  // Note: `assert.ok` is deliberately NOT used to gate these reads — its
  // `asserts` narrowing combined with TS's closure-unaware control-flow
  // analysis mistakenly narrows `capturedBarsOptions`/`capturedBacktestParams`
  // to `never` here (their only textually-visible assignment before this
  // point is the initial `null`; TS does not "step into" the async callbacks
  // above to see the real assignment). The `!` alone is enough — if the
  // callbacks above never fired, these `.symbol`/`.interval` reads throw at
  // runtime exactly as loudly as a failed `assert.ok` would.
  assert.equal(capturedBarsOptions!.symbol, "GBPUSD");
  assert.equal(capturedBarsOptions!.interval, "4h");
  assert.equal(capturedBacktestParams!.symbol, "GBPUSD");
  assert.equal(capturedBacktestParams!.interval, "4h");
  assert.equal(confirmed.strategyProposal?.status, "persisted");
  if (confirmed.strategyProposal?.status === "persisted" && confirmed.strategyProposal.mode === "sandboxed_code") {
    assert.ok(confirmed.strategyProposal.backtest, "the real backtest result is attached to the proposal");
    assert.equal(confirmed.strategyProposal.backtest!.metrics!.tradeCount, 40);
  }
});
