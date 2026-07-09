import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFinalDecisionAgent } from "@/lib/agent/agents/finalDecisionAgent";
import type { FinalDecisionInput } from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import type { RiskAgentResult } from "@/lib/agent/agents/riskAgent";
import { makeRisk, makeStructure, makeValidation } from "./helpers";

function fakeCtx(): AgentRunContext {
  return { requestId: "t", emitActivity: () => {} };
}

function market(over: Partial<AgentMarketContext> = {}): AgentMarketContext {
  return {
    symbol: "EURUSD",
    marketRegime: "range",
    currentTfCandles: [],
    higherTfCandles: [],
    dailyCandles: [],
    ...over,
  } as unknown as AgentMarketContext;
}

function vetoRisk(reasons: string[]): RiskAgentResult {
  return makeRisk({
    validation: makeValidation({ accepted: false, reasons }),
    veto: true,
  });
}

const OLD_CANNED = "لا توجد صفقة واضحة حالياً. الأفضل انتظار وصول السعر إلى منطقة أوضح.";

describe("finalDecisionAgent synthesizer", () => {
  it("risk veto produces WAIT with the ACTUAL rejection reason (not canned)", async () => {
    const ctx = fakeCtx();
    const base: Omit<FinalDecisionInput, "risk"> = {
      userMessage: "حلل",
      news: null,
      market: market(),
      structure: makeStructure(),
      supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
      mtf: null,
    };

    const a = await runFinalDecisionAgent(ctx, {
      ...base,
      risk: vetoRisk(["نسبة العائد/المخاطرة أقل من الحد الأدنى."]),
    });
    const b = await runFinalDecisionAgent(ctx, {
      ...base,
      risk: vetoRisk(["السبريد مرتفع جداً على هذه الأداة."]),
    });

    assert.equal(a.decision, "wait");
    assert.equal(b.decision, "wait");
    assert.ok(a.summary.includes("نسبة العائد/المخاطرة"));
    assert.ok(b.summary.includes("السبريد"));
    // Two different vetoes must NOT read the same, and never the old canned line.
    assert.notEqual(a.summary, b.summary);
    assert.notEqual(a.summary, OLD_CANNED);
    assert.equal(a.riskVeto, true);
  });

  it("no-setup WAIT explains the concrete missing condition, varying by context", async () => {
    const ctx = fakeCtx();
    const rangeWait = await runFinalDecisionAgent(ctx, {
      userMessage: "حلل",
      risk: makeRisk(),
      news: null,
      market: market({ marketRegime: "range" }),
      structure: makeStructure(),
      supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
      mtf: { currentBias: "bullish", higherBias: "bearish", dailyBias: "unknown", conflict: true },
    });
    assert.equal(rangeWait.decision, "wait");
    assert.ok(rangeWait.summary.includes("تعارض")); // htf conflict named
    assert.notEqual(rangeWait.summary, OLD_CANNED);
  });

  it("no-setup WAIT surfaces the candidate engine's exact rejection reason", async () => {
    const ctx = fakeCtx();
    const wait = await runFinalDecisionAgent(ctx, {
      userMessage: "حلل",
      risk: makeRisk({
        candidatesResult: {
          candidates: [],
          best: null,
          rejectedReasons: ["منطقة طلب رُفضت: قوة 40 أقل من الحد."],
          hasReversalEvidence: false,
        },
      }),
      news: null,
      market: market(),
      structure: makeStructure(),
      supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
      mtf: null,
    });
    assert.equal(wait.decision, "wait");
    assert.ok(wait.summary.includes("قوة 40"));
  });
});
