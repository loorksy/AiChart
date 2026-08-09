import assert from "node:assert/strict";
import test from "node:test";
import {
  QUANT_AGENT_QUICK_TOOLS,
  QUANT_AGENT_QUICK_TOOL_KEYS,
  matchQuantAgentQuickToolCommand,
  quantAgentQuickTool,
  resolveQuantAgentQuickToolDispatch,
  type QuantAgentQuickToolAction,
  type QuantAgentQuickToolKey,
} from "@/lib/agent/quantAgentChat/quickTools";
import {
  rankQuantAnalysesByConsensusStrength,
  runQuantAgentChatTurn,
  type QuantAgentChatDeps,
} from "@/lib/agent/quantAgentChat/orchestrator";
import { messagesFor, t } from "@/lib/i18n";
import type { AppLocale } from "@/lib/i18n";
import type { QuantAnalysisRecord } from "@/lib/quantAgent/types";
import type {
  AgentChatMessageRecord,
  AgentChatSession,
  AppendAgentChatMessageInput,
} from "@/lib/agent/chatHistory/types";

const LOCALES: readonly AppLocale[] = ["ar", "en"];

/**
 * QuantDinger's own `order` array (`CopilotWorkbench.vue:832-883`), duplicated
 * here on purpose: a test that read the order from the registry would pass
 * however the registry was reordered.
 */
const UPSTREAM_ORDER: QuantAgentQuickToolKey[] = [
  "market_diagnosis",
  "chart_review",
  "indicator_research",
  "strategy_research",
  "trade_plan",
  "news_research",
  "macro_economic_data",
  "opportunity_radar",
];

/** What each tool must do on click — the dispatch table, stated independently. */
const EXPECTED_ACTIONS: Record<QuantAgentQuickToolKey, QuantAgentQuickToolAction> = {
  market_diagnosis: "analysis",
  chart_review: "unavailable",
  indicator_research: "prompt",
  strategy_research: "prompt",
  trade_plan: "prompt",
  news_research: "prompt",
  macro_economic_data: "prompt",
  opportunity_radar: "radar",
};

const EXPECTED_DISPATCH_KIND: Record<QuantAgentQuickToolAction, "draft" | "send" | "unavailable"> = {
  analysis: "send",
  radar: "send",
  prompt: "draft",
  unavailable: "unavailable",
};

function fakeAnalysis(overrides: Partial<QuantAnalysisRecord> = {}): QuantAnalysisRecord {
  return {
    id: `qan_${overrides.symbol ?? "EURUSD"}`,
    market: "forex",
    symbol: "EURUSD",
    interval: "1h",
    status: "completed",
    decision: "BUY",
    confidence: 71,
    currentPrice: 1.0842,
    entryPrice: 1.0842,
    stopLoss: 1.079,
    takeProfit: 1.093,
    positionSizePct: 10,
    horizon: "short",
    summary: "Uptrend intact on the higher timeframes.",
    scores: { technical: 64, fundamental: 50, sentiment: null, overall: 62 },
    consensus: { decision: "BUY", score: 24, agreement: 0.75, timeframeCount: 4 },
    outlook: null,
    detail: null,
    reasons: [],
    risks: [],
    dataQuality: { degraded: false, missing: [] },
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * A fully-stubbed deps object whose LLM members throw: every Quick Tool test
 * below asserts, by construction, that the engine path never reaches the chat
 * model.
 */
function buildDeps(overrides: Partial<QuantAgentChatDeps> = {}): {
  deps: QuantAgentChatDeps;
  appended: AppendAgentChatMessageInput[];
} {
  const appended: AppendAgentChatMessageInput[] = [];
  const refuseLlm = () => {
    throw new Error("the chat LLM must not be called for a Quick Tool action");
  };
  const deps: QuantAgentChatDeps = {
    listRecommendations: async () => [],
    getRecommendation: async () => null,
    generateAndValidate: async () => {
      throw new Error("not used");
    },
    generateAndValidateCode: async () => {
      throw new Error("not used");
    },
    setStrategyStatus: async () => ({ strategy: { strategy_id: "s", version: "1", display_name: "s", enabled: true, source_generated: true } }),
    backtestQuantStrategy: async () => {
      throw new Error("not used");
    },
    fetchAnalysisBars: async ({ symbol, interval }) => ({
      symbol,
      market: "forex" as const,
      interval: interval ?? "1h",
      bars: [],
    }),
    callLLM: refuseLlm as unknown as QuantAgentChatDeps["callLLM"],
    callLLMStream: refuseLlm as unknown as QuantAgentChatDeps["callLLMStream"],
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
        language: "en",
        createdAt: 0,
        updatedAt: 0,
        pendingTask: null,
      }) as AgentChatSession) as QuantAgentChatDeps["getChat"],
    setPendingTask: (async () => null) as QuantAgentChatDeps["setPendingTask"],
    ...overrides,
  };
  return { deps, appended };
}

// --- The registry ---

test("registry: exactly the eight upstream tools, in upstream's fixed order", () => {
  assert.deepEqual([...QUANT_AGENT_QUICK_TOOL_KEYS], UPSTREAM_ORDER);
  assert.deepEqual(
    QUANT_AGENT_QUICK_TOOLS.map((tool) => tool.key),
    UPSTREAM_ORDER,
  );
  assert.deepEqual(
    QUANT_AGENT_QUICK_TOOLS.map((tool) => tool.order),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  for (const key of UPSTREAM_ORDER) {
    assert.equal(quantAgentQuickTool(key).key, key);
  }
});

test("registry: every tool declares the keys its own action needs", () => {
  for (const tool of QUANT_AGENT_QUICK_TOOLS) {
    assert.equal(tool.action, EXPECTED_ACTIONS[tool.key], `${tool.key} action`);
    assert.equal(tool.labelKey, `qa.quicktool.${tool.key}.label`);
    assert.equal(tool.descriptionKey, `qa.quicktool.${tool.key}.desc`);
    if (tool.action === "prompt") {
      assert.ok(tool.promptKey, `${tool.key} is a prefill tool with no prompt key`);
      assert.equal(tool.commandKey, undefined, `${tool.key} must not carry a command`);
    }
    if (tool.action === "analysis" || tool.action === "radar") {
      assert.ok(tool.commandKey, `${tool.key} is an engine tool with no command key`);
      assert.equal(tool.promptKey, undefined, `${tool.key} must not also prefill`);
    }
    if (tool.action === "unavailable") {
      assert.ok(tool.noteKey, `${tool.key} is unavailable and must say why`);
    }
  }
});

// --- The dispatch table ---

test("dispatch: each action maps to its one expected outcome", () => {
  for (const tool of QUANT_AGENT_QUICK_TOOLS) {
    const dispatch = resolveQuantAgentQuickToolDispatch(tool, { locale: "en", symbol: "EURUSD" });
    assert.equal(dispatch.kind, EXPECTED_DISPATCH_KIND[tool.action], `${tool.key} dispatch kind`);
  }
  // Only the two genuine agent actions may send.
  assert.deepEqual(
    QUANT_AGENT_QUICK_TOOLS.filter(
      (tool) => resolveQuantAgentQuickToolDispatch(tool, { locale: "en", symbol: "EURUSD" }).kind === "send",
    ).map((tool) => tool.key),
    ["market_diagnosis", "opportunity_radar"],
  );
});

test("dispatch: a prefill tool only fills the draft — it never sends and never triggers an action", () => {
  for (const locale of LOCALES) {
    for (const tool of QUANT_AGENT_QUICK_TOOLS.filter((entry) => entry.action === "prompt")) {
      const dispatch = resolveQuantAgentQuickToolDispatch(tool, { locale, symbol: "EURUSD" });
      assert.equal(dispatch.kind, "draft", `${tool.key} must never auto-send`);
      assert.ok(dispatch.kind === "draft" && dispatch.text.trim().length > 0);
      if (dispatch.kind !== "draft") continue;
      if (tool.usesSymbol) {
        assert.ok(dispatch.text.includes("EURUSD"), `${tool.key} lost the symbol in ${locale}`);
        assert.ok(!dispatch.text.includes("{symbol}"), `${tool.key} left {symbol} unreplaced in ${locale}`);
      }
      // Even if the user sends the prefilled draft unedited, it must reach the
      // normal chat path — never an engine action.
      assert.equal(
        matchQuantAgentQuickToolCommand(dispatch.text),
        null,
        `${tool.key}'s prompt must not be readable as an engine command`,
      );
    }
  }
});

test("dispatch: the unavailable tool states its reason instead of running", () => {
  const dispatch = resolveQuantAgentQuickToolDispatch(quantAgentQuickTool("chart_review"), {
    locale: "en",
    symbol: "EURUSD",
  });
  assert.equal(dispatch.kind, "unavailable");
  assert.ok(dispatch.kind === "unavailable" && dispatch.reason.trim().length > 0);
});

// --- Recognising a dispatched command ---

test("command matching: recognises what the tile sent, in both locales, and captures the symbol", () => {
  for (const locale of LOCALES) {
    const diagnosis = resolveQuantAgentQuickToolDispatch(quantAgentQuickTool("market_diagnosis"), {
      locale,
      symbol: "XAUUSD",
    });
    assert.equal(diagnosis.kind, "send");
    const matchedDiagnosis = matchQuantAgentQuickToolCommand(
      diagnosis.kind === "send" ? diagnosis.text : "",
    );
    assert.equal(matchedDiagnosis?.key, "market_diagnosis");
    assert.equal(matchedDiagnosis?.action, "analysis");
    assert.equal(matchedDiagnosis?.symbol, "XAUUSD");

    const radar = resolveQuantAgentQuickToolDispatch(quantAgentQuickTool("opportunity_radar"), {
      locale,
      symbol: "XAUUSD",
    });
    const matchedRadar = matchQuantAgentQuickToolCommand(radar.kind === "send" ? radar.text : "");
    assert.equal(matchedRadar?.key, "opportunity_radar");
    assert.equal(matchedRadar?.action, "radar");
  }
});

test("command matching: fails closed on anything that is not a dispatched command", () => {
  for (const message of [
    "",
    "   ",
    "what does the opportunity radar do?",
    "diagnose my portfolio please",
    "Scan my watchlist for likely opportunities in the next 24 hours, but only EURUSD.",
    "create a new strategy for gold",
  ]) {
    assert.equal(matchQuantAgentQuickToolCommand(message), null, `must not match: ${message}`);
  }
});

// --- The two real dispatches ---

test("diagnosis: runs the analysis engine and never calls the chat LLM", async () => {
  const record = fakeAnalysis({ symbol: "XAUUSD", decision: "SELL", confidence: 64 });
  const calls: { symbol: string; interval: string }[] = [];
  const { deps, appended } = buildDeps({
    runAnalysis: (async (input) => {
      calls.push({ symbol: input.symbol, interval: input.interval ?? "" });
      return record;
    }) as QuantAgentChatDeps["runAnalysis"],
  });

  const command = resolveQuantAgentQuickToolDispatch(quantAgentQuickTool("market_diagnosis"), {
    locale: "en",
    symbol: "XAUUSD",
  });
  const result = await runQuantAgentChatTurn(
    {
      userId: 1,
      chatId: "chat_qt_1",
      message: command.kind === "send" ? command.text : "",
      locale: "en",
      symbol: "XAUUSD",
      interval: "4h",
    },
    deps,
  );

  assert.deepEqual(calls, [{ symbol: "XAUUSD", interval: "4h" }]);
  assert.equal(result.quickTool, "market_diagnosis");
  assert.deepEqual(
    result.analyses.map((analysis) => analysis.id),
    [record.id],
  );
  // The reply is assembled from the stored row, not from a model.
  assert.ok(result.reply.includes("XAUUSD"));
  assert.ok(result.reply.includes("64%"));
  // User turn + assistant turn, and the assistant turn carries the analysis.
  assert.equal(appended.length, 2);
  const stored = appended[1]?.result as { quickTool?: string; analyses?: QuantAnalysisRecord[] };
  assert.equal(stored.quickTool, "market_diagnosis");
  assert.equal(stored.analyses?.length, 1);
});

test("diagnosis: a rejected run reports the reason instead of a fabricated verdict", async () => {
  const { deps } = buildDeps({
    runAnalysis: (async () => {
      throw new Error("رمز غير صالح.");
    }) as QuantAgentChatDeps["runAnalysis"],
  });
  const command = resolveQuantAgentQuickToolDispatch(quantAgentQuickTool("market_diagnosis"), {
    locale: "en",
    symbol: "EURUSD",
  });
  const result = await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_qt_2", message: command.kind === "send" ? command.text : "", locale: "en" },
    deps,
  );
  assert.equal(result.analyses.length, 0);
  assert.ok(result.reply.includes("رمز غير صالح."));
});

test("radar: sweeps the watchlist and ranks by abs(consensus score) descending", async () => {
  const bySymbol: Record<string, QuantAnalysisRecord> = {
    EURUSD: fakeAnalysis({ symbol: "EURUSD", consensus: { decision: "BUY", score: 12, agreement: 0.5, timeframeCount: 4 } }),
    GBPUSD: fakeAnalysis({
      symbol: "GBPUSD",
      decision: "SELL",
      consensus: { decision: "SELL", score: -41, agreement: 0.8, timeframeCount: 4 },
    }),
    USDJPY: fakeAnalysis({ symbol: "USDJPY", consensus: { decision: "BUY", score: 27, agreement: 0.6, timeframeCount: 4 } }),
  };
  const { deps } = buildDeps({
    listWatchlist: (async () => [
      { id: 1, userId: 1, symbol: "EURUSD", market: "forex", createdAt: 3 },
      { id: 2, userId: 1, symbol: "GBPUSD", market: "forex", createdAt: 2 },
      { id: 3, userId: 1, symbol: "USDJPY", market: "forex", createdAt: 1 },
    ]) as QuantAgentChatDeps["listWatchlist"],
    runAnalysis: (async (input) => bySymbol[input.symbol]!) as QuantAgentChatDeps["runAnalysis"],
  });

  const command = resolveQuantAgentQuickToolDispatch(quantAgentQuickTool("opportunity_radar"), {
    locale: "en",
    symbol: "EURUSD",
  });
  const result = await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_qt_3", message: command.kind === "send" ? command.text : "", locale: "en" },
    deps,
  );

  assert.equal(result.quickTool, "opportunity_radar");
  assert.deepEqual(
    result.analyses.map((analysis) => analysis.symbol),
    ["GBPUSD", "USDJPY", "EURUSD"],
  );
  assert.ok(result.reply.indexOf("GBPUSD") < result.reply.indexOf("USDJPY"));
  assert.ok(result.reply.indexOf("USDJPY") < result.reply.indexOf("EURUSD"));
});

test("radar: an empty watchlist says so rather than scanning nothing quietly", async () => {
  const { deps } = buildDeps({
    listWatchlist: (async () => []) as QuantAgentChatDeps["listWatchlist"],
    runAnalysis: (async () => {
      throw new Error("no symbol should be analysed");
    }) as QuantAgentChatDeps["runAnalysis"],
  });
  const command = resolveQuantAgentQuickToolDispatch(quantAgentQuickTool("opportunity_radar"), {
    locale: "en",
    symbol: "EURUSD",
  });
  const result = await runQuantAgentChatTurn(
    { userId: 1, chatId: "chat_qt_4", message: command.kind === "send" ? command.text : "", locale: "en" },
    deps,
  );
  assert.equal(result.analyses.length, 0);
  assert.equal(result.reply, t("en", "qa.quicktool.radar.empty"));
});

test("ranking: a run with no consensus sorts below every completed one", () => {
  const ranked = rankQuantAnalysesByConsensusStrength([
    fakeAnalysis({ symbol: "A", status: "failed", consensus: null }),
    fakeAnalysis({ symbol: "B", consensus: { decision: "BUY", score: 5, agreement: 0.5, timeframeCount: 4 } }),
    fakeAnalysis({ symbol: "C", consensus: { decision: "SELL", score: -60, agreement: 0.9, timeframeCount: 4 } }),
  ]);
  assert.deepEqual(
    ranked.map((analysis) => analysis.symbol),
    ["C", "B", "A"],
  );
});

// --- i18n ---

function quickToolKeys(locale: AppLocale): string[] {
  return Object.keys(messagesFor(locale)).filter((key) => key.startsWith("qa.quicktool."));
}

test("i18n: the same qa.quicktool.* key set, non-empty, in both locales", () => {
  const en = new Set(quickToolKeys("en"));
  const ar = new Set(quickToolKeys("ar"));
  assert.ok(en.size > 0, "no qa.quicktool.* keys found in en");
  for (const key of en) assert.ok(ar.has(key), `ar is missing "${key}"`);
  for (const key of ar) assert.ok(en.has(key), `en is missing "${key}"`);
  for (const locale of LOCALES) {
    const messages = messagesFor(locale);
    for (const key of quickToolKeys(locale)) {
      assert.ok(messages[key]?.trim().length, `${locale} has an empty value for "${key}"`);
    }
  }
});

test("i18n: every key the registry names resolves, with its {symbol} placeholder intact", () => {
  for (const locale of LOCALES) {
    for (const tool of QUANT_AGENT_QUICK_TOOLS) {
      for (const key of [tool.labelKey, tool.descriptionKey, tool.promptKey, tool.commandKey, tool.noteKey]) {
        if (!key) continue;
        assert.notEqual(t(locale, key), key, `${locale} is missing "${key}"`);
      }
      const templated = tool.promptKey ?? tool.commandKey;
      if (templated && tool.usesSymbol) {
        assert.ok(
          t(locale, templated).includes("{symbol}"),
          `${locale} lost the {symbol} placeholder on "${templated}"`,
        );
      }
    }
    for (const key of ["qa.quicktool.title", "qa.quicktool.description", "qa.quicktool.unavailable"]) {
      assert.notEqual(t(locale, key), key, `${locale} is missing "${key}"`);
    }
  }
});
