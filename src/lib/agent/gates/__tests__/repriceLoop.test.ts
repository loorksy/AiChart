/**
 * The production refusal of 2026-08-26, reproduced end to end — and fixed.
 *
 * What the user saw: a 15m XAUUSD analysis authored a plan, G7 found the stop
 * (4608.13) already at/behind the live price, and the platform answered
 * «السعر بلغ وقف الخسارة … وقفها مضروب سلفاً» with an empty 0% card. Two
 * distinct faults compounded:
 *
 *  1. The revalidation stop check was mode-blind: a PENDING breakdown sell has
 *     the live market above its stop BY CONSTRUCTION, and was refused as
 *     already lost (pinned in revalidation.test.ts and again here through the
 *     real gate chain).
 *  2. A genuine stale veto (a MARKET plan whose stop the live price really did
 *     pass) hard-refused instead of feeding "the move already happened" back
 *     into one corrective resynthesis priced against the live quote.
 *
 * This file drives the REAL pipeline pieces the orchestrator wires together —
 * runFinalDecisionSynthesizer (injected model), buildGates + runGateChain,
 * repriceStaleScenario — so the assertion is about the shipped path, not a
 * re-implementation of it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runFinalDecisionSynthesizer,
} from "@/lib/agent/agents/finalDecisionSynthesizer";
import type { FinalDecisionResult } from "@/lib/agent/agents/finalDecisionAgent";
import type { FinalDecisionInput } from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import type { NewsMacroResult } from "@/lib/agent/agents/newsMacroAgent";
import { resolveEntryType } from "@/lib/recommendations/entrySemantics";
import { buildGates } from "../buildGates";
import { runGateChain } from "../chain";
import type { GateChainResult } from "../types";
import {
  isStaleScenarioVeto,
  repriceStaleScenario,
  staleScenarioFeedback,
} from "../repriceLoop";
import { makeLiquidity, makeRisk, makeStructure } from "../../__tests__/helpers";

const ctx: AgentRunContext = { requestId: "reprice-test", emitActivity: () => {} };

/** ATR 6 → stop safety buffer 2.4 (0.4·ATR), level tolerance 2.1 (0.35·ATR). */
const ATR = 6;

/** Every price a plan in this file quotes, so grounding never interferes. */
const MENU = {
  support: [4620, 4612, 4605, 4600, 4599, 4595, 4586, 4605.3, 4608.1, 4610],
  resistance: [4652, 4641, 4640, 4635, 4630, 4626, 4618],
};

function makeMarket(currentPrice: number): AgentMarketContext {
  return {
    symbol: "XAUUSD",
    interval: "15m",
    currentPrice,
    marketRegime: "trend",
    atr: ATR,
    dataQuality: {
      currentTfCount: 600,
      higherTfCount: 250,
      dailyCount: 120,
      sufficient: true,
      policyVersion: "1.1.0",
    },
    currentTfCandles: [],
    higherTfCandles: [],
    dailyCandles: [],
    majorLevels: {
      support: MENU.support.map((price, i) => ({ price, time: i + 1 })),
      resistance: MENU.resistance.map((price, i) => ({ price, time: i + 100 })),
    },
    zones: [],
    liquidity: {
      equalHighs: [],
      equalLows: [],
      nearestBuySide: null,
      nearestSellSide: null,
    },
  } as unknown as AgentMarketContext;
}

const benignNews: NewsMacroResult = {
  newsRisk: "low",
  biasImpact: "unknown",
  affectedCurrencies: ["USD"],
  upcomingEvents: [],
  tradeAllowed: true,
  reason: "no upcoming releases",
};

function decisionJson(over: Record<string, unknown>): string {
  return JSON.stringify({
    direction: "buy",
    planType: "immediate",
    selectedTradeCandidateId: null,
    proposedLevels: null,
    activationCondition: null,
    activationRule: null,
    invalidationRule: "A 15m close beyond the stop kills the idea.",
    alternativeScenario: "Failure at the level flips the read.",
    validityCandles: 12,
    confidence: 0.7,
    summary: "An evidence-grounded XAUUSD plan on the 15m structure and levels.",
    keyReasons: ["structure supports the direction"],
    riskWarnings: [],
    publicReasoningSummary: ["level-based read"],
    decisionTrace: {
      hypotheses: [
        { scenario: "continuation", supporting: ["structure"], opposing: [] },
      ],
      chosenBecause: "the strongest evidence side",
      planTypeBecause: "chosen from what already played out on the charts",
    },
    drawingAdvice: { shouldDraw: false, reason: "test" },
    ...over,
  });
}

interface PipelineRun {
  first: FinalDecisionResult;
  firstChain: GateChainResult;
  outcome: Awaited<ReturnType<typeof repriceStaleScenario<FinalDecisionResult>>>;
  /** System prompt of each model call, in order — where the feedback lands. */
  systems: string[];
  resynthesizeCalls: number;
}

/**
 * The orchestrator's wiring, minus persistence: author with the REAL
 * synthesizer, gate with the REAL chain (injected live quote), then run the
 * REAL reprice loop. The retry decides against the live price, exactly as the
 * orchestrator refreshes it.
 */
async function runPipeline(opts: {
  authoringPrice: number;
  livePrice: number;
  firstAnswer: string;
  retryAnswer?: string;
  news?: NewsMacroResult;
}): Promise<PipelineRun> {
  const structure = makeStructure();
  const liquidity = makeLiquidity();
  const supplyDemand = { zones: [], nearestDemand: null, nearestSupply: null };
  const news = opts.news ?? benignNews;
  const systems: string[] = [];

  const synthesize = async (
    feedback: string | null,
    currentPrice: number,
  ): Promise<FinalDecisionResult | null> => {
    const input = {
      userMessage: "حلل الذهب وأعطني توصية",
      risk: makeRisk(),
      news: null,
      market: makeMarket(currentPrice),
      structure,
      supplyDemand,
      mtf: null,
      candidates: [],
      skillContextBlock: feedback,
    } as unknown as FinalDecisionInput & { candidates: [] };
    const out = await runFinalDecisionSynthesizer(ctx, input, {
      configured: true,
      callModel: async (system) => {
        systems.push(system);
        return feedback == null ? opts.firstAnswer : opts.retryAnswer!;
      },
    });
    return out.result;
  };

  const evaluate = async (
    decision: FinalDecisionResult,
  ): Promise<GateChainResult | null> => {
    const rec = decision.recommendation;
    if (!rec || rec.entry == null || rec.stop_loss == null || !rec.targets?.length) {
      return null;
    }
    const entryType = resolveEntryType({
      declared: rec.entryType,
      planType: rec.planType ?? decision.planType,
      activationRule: rec.activationRule,
    });
    const { gates } = buildGates({
      now: Date.now(),
      news,
      newsProviderConfigured: true,
      structure,
      liquidity,
      supplyDemand,
      mtf: null,
      atr: ATR,
      visualTimeframes: ["15m"],
      plan: {
        direction: decision.decision === "buy" ? "buy" : "sell",
        entryType,
        entry: rec.entry!,
        stopLoss: rec.stop_loss!,
        targets: rec.targets!,
        activationRule: rec.activationRule ?? null,
      },
      fetchLivePrice: async () => opts.livePrice,
    });
    return runGateChain(gates);
  };

  const first = await synthesize(null, opts.authoringPrice);
  assert.ok(first, "the authoring pass must produce a decision");
  const firstChain = await evaluate(first);
  assert.ok(firstChain, "the authored plan must be gateable");

  let resynthesizeCalls = 0;
  const rec = first.recommendation!;
  const outcome = await repriceStaleScenario<FinalDecisionResult>({
    decision: first,
    chain: firstChain,
    plan: {
      direction: first.decision === "buy" ? "buy" : "sell",
      entry: rec.entry!,
      stopLoss: rec.stop_loss!,
      targets: rec.targets ?? [],
    },
    resynthesize: async (feedback) => {
      resynthesizeCalls += 1;
      // The orchestrator refreshes the retry's quote to the one G7 measured.
      return synthesize(feedback, opts.livePrice);
    },
    evaluate,
  });

  return { first, firstChain, outcome, systems, resynthesizeCalls };
}

describe("stale-scenario reprice: the refusal becomes a repriced, actionable plan", () => {
  it("immediate BUY whose stop the live price fell through → repriced immediate plan, not «وقفها مضروب»", async () => {
    // Authored at 4620 with a 4612 structural stop (buffered to 4609.60); by
    // gate time the market printed 4606 — through the stop. The old pipeline
    // published the refusal; now the veto becomes scenario feedback and the
    // retry answers with a plan priced at the market that exists.
    const run = await runPipeline({
      authoringPrice: 4620,
      livePrice: 4606,
      firstAnswer: decisionJson({
        proposedLevels: { preferredEntry: 4620, stopLoss: 4612, targets: [4640, 4652] },
      }),
      retryAnswer: decisionJson({
        proposedLevels: { preferredEntry: 4605, stopLoss: 4599, targets: [4618, 4630] },
      }),
    });

    // The reproduction: the first chain says exactly what production said.
    assert.equal(run.firstChain.allowed, false);
    assert.equal(run.firstChain.vetoedBy?.id, "G7");
    assert.match(run.firstChain.vetoedBy?.reasonAr ?? "", /وقفها مضروب/);

    // The fix: one corrective retry, carrying the scenario feedback…
    assert.equal(run.resynthesizeCalls, 1);
    assert.equal(run.systems.length, 2, "authoring call + one reprice call");
    const retrySystem = run.systems[1]!;
    assert.match(retrySystem, /LIVE-PRICE REVALIDATION FEEDBACK/);
    assert.match(retrySystem, /4606\.00/, "the retry is told the live price");
    assert.match(
      retrySystem,
      /already at or beyond the stop/,
      "the retry is told WHICH scenario occurred",
    );
    assert.match(run.outcome.feedback ?? "", /ALREADY|already/);

    // …and the emitted plan is actionable at the current market.
    assert.equal(run.outcome.repriced, true);
    assert.equal(run.outcome.chain.allowed, true);
    assert.equal(run.outcome.decision.decision, "buy");
    assert.equal(run.outcome.decision.recommendation?.entry, 4605);
    assert.ok(
      (run.outcome.decision.recommendation?.stop_loss ?? 0) < 4606,
      "the repriced stop sits under the live price",
    );
  });

  it("immediate SELL whose stop the live price rose through → repriced CONDITIONAL at fresh levels", async () => {
    // The mirrored side, and the other retry shape: the market ran up through
    // the sell's stop, and the retry chooses a fresh conditional — a rejection
    // at the supply overhead — instead of chasing.
    const run = await runPipeline({
      authoringPrice: 4620,
      livePrice: 4630,
      firstAnswer: decisionJson({
        direction: "sell",
        proposedLevels: { preferredEntry: 4620, stopLoss: 4626, targets: [4610, 4600] },
      }),
      retryAnswer: decisionJson({
        direction: "sell",
        planType: "conditional",
        activationCondition: "A 15m close below 4610 confirms the breakdown.",
        activationRule: {
          kind: "candle_close_below",
          level: 4610,
          timeframe: "15m",
        },
        proposedLevels: { preferredEntry: 4610, stopLoss: 4618, targets: [4600, 4595] },
      }),
    });

    assert.equal(run.firstChain.allowed, false);
    assert.equal(run.firstChain.vetoedBy?.id, "G7");
    assert.match(run.firstChain.vetoedBy?.reasonAr ?? "", /وقفها مضروب/);

    assert.equal(run.resynthesizeCalls, 1);
    assert.match(run.systems[1]!, /4630\.00/, "the sell retry sees ITS live price");

    assert.equal(run.outcome.repriced, true);
    assert.equal(run.outcome.chain.allowed, true, "a waiting retry passes the same chain");
    assert.equal(run.outcome.decision.decision, "sell");
    assert.equal(run.outcome.decision.planType, "conditional");
    assert.equal(run.outcome.decision.recommendation?.entry, 4610);
    assert.equal(
      run.outcome.decision.executionState,
      "awaiting_activation",
      "a conditional reprice waits for its trigger — it is not forced immediate",
    );
  });

  it("a retry that re-emits the overtaken levels is refused — honestly, by name", async () => {
    const run = await runPipeline({
      authoringPrice: 4620,
      livePrice: 4606,
      firstAnswer: decisionJson({
        proposedLevels: { preferredEntry: 4620, stopLoss: 4612, targets: [4640, 4652] },
      }),
      // The model ignores the feedback and anchors to the same stale numbers.
      retryAnswer: decisionJson({
        proposedLevels: { preferredEntry: 4620, stopLoss: 4612, targets: [4640, 4652] },
      }),
    });

    assert.equal(run.resynthesizeCalls, 1, "exactly ONE reprice round — never a loop");
    assert.equal(run.outcome.repriced, true, "the retry decision is adopted…");
    assert.equal(run.outcome.chain.allowed, false, "…and its own chain refuses it");
    assert.equal(run.outcome.chain.vetoedBy?.id, "G7");
  });

  it("a genuinely untradeable market (news blackout) is never repriced", async () => {
    const inWindow: NewsMacroResult = {
      ...benignNews,
      newsRisk: "high",
      upcomingEvents: [
        {
          title: "US CPI",
          time: new Date(Date.now() + 10 * 60_000).toISOString(),
          impact: "high",
          currency: "USD",
        },
      ] as NewsMacroResult["upcomingEvents"],
    };
    const run = await runPipeline({
      authoringPrice: 4620,
      livePrice: 4620,
      news: inWindow,
      firstAnswer: decisionJson({
        proposedLevels: { preferredEntry: 4620, stopLoss: 4612, targets: [4640, 4652] },
      }),
    });

    assert.equal(run.firstChain.allowed, false);
    assert.equal(run.firstChain.vetoedBy?.id, "G1", "the blackout vetoes first");
    assert.equal(isStaleScenarioVeto(run.firstChain), false);
    assert.equal(run.resynthesizeCalls, 0, "no reprice — this refusal is about the market");
    assert.equal(run.outcome.repriced, false);
    assert.equal(run.outcome.feedback, null);
  });

  it("the production PENDING sell passes the chain outright — no retry spent at all", async () => {
    // The incident geometry through the real chain: a conditional breakdown
    // sell below the market, its (buffered) stop under the live price. The
    // mode-aware G7 recognizes the approach path and the plan ships as the
    // conditional it was written to be — the reprice loop never activates.
    const run = await runPipeline({
      authoringPrice: 4613,
      livePrice: 4613,
      firstAnswer: decisionJson({
        direction: "sell",
        planType: "conditional",
        activationCondition: "A 15m close below 4605.3 confirms the breakdown.",
        activationRule: { kind: "candle_close_below", level: 4605.3, timeframe: "15m" },
        proposedLevels: { preferredEntry: 4605.3, stopLoss: 4608.1, targets: [4595, 4586] },
      }),
    });

    assert.equal(run.firstChain.allowed, true, "the geometry production refused now passes");
    assert.equal(run.resynthesizeCalls, 0);
    assert.equal(run.outcome.repriced, false);
    const rec = run.outcome.decision.recommendation!;
    assert.equal(run.outcome.decision.planType, "conditional");
    assert.ok(
      (rec.stop_loss ?? 0) > (rec.entry ?? 0),
      "the sell stop sits above its own entry (buffer applied away from the fill)",
    );
    assert.ok(
      (rec.stop_loss ?? 0) < 4613,
      "…and below the live market: the buffered stop no longer self-refuses the plan",
    );
  });

  it("mirrors for a pending BUY breakout above the market", async () => {
    const run = await runPipeline({
      authoringPrice: 4613,
      livePrice: 4613,
      firstAnswer: decisionJson({
        direction: "buy",
        planType: "conditional",
        activationCondition: "A 15m close above 4618 confirms the breakout.",
        activationRule: { kind: "candle_close_above", level: 4618, timeframe: "15m" },
        proposedLevels: { preferredEntry: 4618, stopLoss: 4612, targets: [4630, 4640] },
      }),
    });
    assert.equal(run.firstChain.allowed, true);
    assert.equal(run.resynthesizeCalls, 0);
    const rec = run.outcome.decision.recommendation!;
    assert.ok((rec.stop_loss ?? 0) < (rec.entry ?? 0));
    assert.ok(
      (rec.stop_loss ?? 0) < 4613,
      "a pending buy's stop under the live price is approach geometry, not a breach",
    );
  });
});

describe("the feedback block itself", () => {
  it("names the levels, the live price, and both follow-through choices", async () => {
    const run = await runPipeline({
      authoringPrice: 4620,
      livePrice: 4606,
      firstAnswer: decisionJson({
        proposedLevels: { preferredEntry: 4620, stopLoss: 4612, targets: [4640, 4652] },
      }),
      retryAnswer: decisionJson({
        proposedLevels: { preferredEntry: 4605, stopLoss: 4599, targets: [4618, 4630] },
      }),
    });
    const feedback = staleScenarioFeedback({
      chain: run.firstChain,
      plan: { direction: "buy", entry: 4620, stopLoss: 4609.6, targets: [4640, 4652] },
    });
    assert.ok(feedback);
    assert.match(feedback!, /4609\.60/, "the overtaken stop is named");
    assert.match(feedback!, /IMMEDIATE entry at the current price/);
    assert.match(feedback!, /NEW conditional plan/);
    assert.match(feedback!, /Do NOT re-emit the previous levels/);
  });

  it("returns null for every veto that is not scenario staleness", () => {
    const chain: GateChainResult = {
      allowed: false,
      confidenceDelta: 0,
      verdicts: [],
      vetoedBy: {
        id: "G6",
        name: "geometry",
        status: "veto",
        reasonAr: "خطة غير متماسكة",
        startedAt: 0,
        finishedAt: 0,
      },
    };
    assert.equal(
      staleScenarioFeedback({
        chain,
        plan: { direction: "buy", entry: 1, stopLoss: 1, targets: [1] },
      }),
      null,
    );
  });
});
