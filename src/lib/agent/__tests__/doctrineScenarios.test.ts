/**
 * The reference scenario pack (docs/UNIFIED_AGENT_PLAN.md §17, §19).
 *
 * Each case is a market situation that used to end in "no opinion" — a range,
 * a forming pattern, conflicting timeframes, no matching strategy, costs that
 * eat the move, a release minutes away, a structure with no name. The model is
 * stubbed so these test the CONTRACT, not the model's taste: whatever it
 * decides, a successful analysis must come back with a direction, a plan type,
 * an execution state, and levels that are either grounded or absent-and-said-so.
 *
 * Every case also names its forbidden outcome, because the failure mode here is
 * not a crash — it is a plausible-looking answer with nothing actionable in it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFinalDecisionSynthesizer } from "@/lib/agent/agents/finalDecisionSynthesizer";
import type { FinalDecisionInput } from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import type { TradeCandidate } from "@/lib/agent/trading/buildTradeCandidates";
import { makeRisk, makeStructure } from "./helpers";

const ctx: AgentRunContext = { requestId: "scenario", emitActivity: () => {} };

function market(over: Partial<AgentMarketContext> = {}): AgentMarketContext {
  return {
    symbol: "XAUUSD",
    interval: "5m",
    currentPrice: 4000,
    atr: 2,
    spread: 0.2,
    marketRegime: "range",
    dataQuality: {
      currentTfCount: 600,
      higherTfCount: 250,
      dailyCount: 120,
      sufficient: true,
      policyVersion: "1.2.0",
    },
    currentTfCandles: [],
    higherTfCandles: [],
    dailyCandles: [],
    majorLevels: {
      support: [{ price: 3990, time: 1 }],
      resistance: [{ price: 4010, time: 2 }],
    },
    zones: [{ type: "demand", low: 3992, high: 3996, time: 3 }],
    liquidity: { equalHighs: [], equalLows: [], nearestBuySide: null, nearestSellSide: null },
    ...over,
  } as unknown as AgentMarketContext;
}

function candidate(over: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    id: "tc-0",
    action: "buy",
    entry: 3996,
    entryType: "buy_limit",
    stop_loss: 3990,
    targets: [4010, 4020],
    rr: 2.4,
    netRr: 2.3,
    netRrTp2: 4,
    activationClass: "conditional",
    activationDistance: 4,
    activationDistanceAtr: 2,
    qualityScore: 0.7,
    triggerCondition: "return to the demand zone",
    setupType: "range_boundary",
    poi: {
      type: "demand",
      low: 3992,
      high: 3996,
      score: { score: 72, grade: "B", reasons: [], warnings: [], isTradable: true },
    },
    evidence: ["zone held twice"],
    warnings: [],
    invalidationReason: "close below 3990",
    ...over,
  } as TradeCandidate;
}

function answer(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    direction: "buy",
    planType: "conditional",
    selectedTradeCandidateId: null,
    proposedLevels: null,
    activationCondition: "رفض صاعد واضح من 3996.",
    activationRule: { kind: "rejection_confirmed", level: 3996, direction: "above", timeframe: "5m" },
    invalidationRule: "إغلاق تحت 3990 يبطل الفكرة.",
    alternativeScenario: "كسر 3990 يقلب المشهد إلى بيع نحو 3980.",
    validityCandles: 6,
    confidence: 0.7,
    summary: "XAUUSD: the plan waits at the range floor rather than chasing mid-range.",
    keyReasons: ["range floor held twice"],
    riskWarnings: [],
    publicReasoningSummary: ["range structure"],
    decisionTrace: {
      hypotheses: [
        { scenario: "ارتداد من قاع النطاق", supporting: ["رفض مرتين"], opposing: ["زخم ضعيف"] },
        { scenario: "اختراق هابط", supporting: ["ضغط بيعي"], opposing: ["لا إغلاق تحت القاع"] },
      ],
      chosenBecause: "القاع لم يُكسر بإغلاق.",
      planTypeBecause: "السعر في منتصف النطاق الآن.",
    },
    drawingAdvice: { shouldDraw: true, reason: "range" },
    ...over,
  });
}

async function decide(
  input: Partial<FinalDecisionInput & { candidates: [] }>,
  modelJson: string,
) {
  const base: FinalDecisionInput & { candidates: [] } = {
    userMessage: "analyze",
    risk: makeRisk(),
    news: null,
    market: market(),
    structure: makeStructure(),
    supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
    mtf: null,
    candidates: [],
  };
  return runFinalDecisionSynthesizer(
    ctx,
    { ...base, ...input },
    { configured: true, callModel: async () => modelJson },
  );
}

/** Every successful analysis owes the operator these, whatever it decided. */
function assertCompletePlan(result: NonNullable<Awaited<ReturnType<typeof decide>>["result"]>) {
  assert.ok(result.decision === "buy" || result.decision === "sell", "a direction is mandatory");
  assert.ok(
    ["immediate", "anticipatory", "conditional"].includes(result.planType ?? ""),
    "a plan type is mandatory",
  );
  assert.ok(result.executionState, "an execution state is mandatory");
  assert.ok(result.recommendation.invalidationRule, "what kills the idea must be stated");
  assert.ok(result.recommendation.alternativeScenario, "the runner-up scenario must be stated");
  assert.ok((result.recommendation.validityCandles ?? 0) > 0, "validity must be stated");
  assert.ok(result.decisionTrace?.chosenBecause, "the decision must be explainable");
  assert.ok((result.evidenceDimensions ?? []).length > 0, "the evidence card must be present");
}

describe("doctrine scenarios", () => {
  it("clear trend → immediate plan with bound levels", async () => {
    const tc = candidate({ activationClass: "immediate", entry: 4000, entryType: "market" });
    const out = await decide(
      { risk: makeRisk({ selectedCandidate: tc, candidatesResult: { candidates: [tc], best: tc, rejectedReasons: [], hasReversalEvidence: false } }) },
      answer({ planType: "immediate", selectedTradeCandidateId: "tc-0", activationCondition: null, activationRule: null }),
    );
    assertCompletePlan(out.result!);
    assert.equal(out.result?.executionState, "valid_now");
    assert.equal(out.result?.recommendation.stop_loss, 3990);
  });

  it("tight range mid-position → conditional plan at an edge, never 'no opportunity'", async () => {
    const out = await decide({}, answer());
    assertCompletePlan(out.result!);
    assert.equal(out.result?.planType, "conditional");
    // Forbidden: silently dropping to nothing because price sits mid-range.
    assert.notEqual(out.result?.decision, undefined);
  });

  it("forming pattern → anticipatory plan carrying its own risk label", async () => {
    const tc = candidate({ setupType: "range_boundary" });
    const out = await decide(
      { risk: makeRisk({ selectedCandidate: tc, candidatesResult: { candidates: [tc], best: tc, rejectedReasons: [], hasReversalEvidence: false } }) },
      answer({
        planType: "anticipatory",
        selectedTradeCandidateId: "tc-0",
        activationCondition: "الدخول من قيعان المثلث الصاعد قبل الاختراق.",
        activationRule: { kind: "price_touch", level: 3996, timeframe: "5m" },
        riskWarnings: ["دخول استباقي — مخاطرة أعلى من الدخول بعد التأكيد."],
      }),
    );
    assertCompletePlan(out.result!);
    assert.equal(out.result?.planType, "anticipatory");
    assert.ok(out.result?.riskWarnings.some((w) => w.includes("استباقي")));
  });

  it("conflicting timeframes → a resolved direction, not an absent one", async () => {
    const out = await decide(
      {
        mtf: {
          conflict: true,
          currentBias: "bullish",
          higherBias: "bearish",
          dailyBias: "bearish",
        } as unknown as FinalDecisionInput["mtf"],
      },
      answer({ keyReasons: ["الفريم الأدنى يقود التوقيت بينما اليومي سياق هابط"] }),
    );
    assertCompletePlan(out.result!);
    const dim = out.result?.evidenceDimensions?.find((d) => d.key === "timeframe_agreement");
    assert.equal(dim?.grade, "weak", "the conflict is reported, not hidden");
  });

  it("no matching strategy → plan stands, labelled as unsupported", async () => {
    const out = await decide({}, answer());
    const support = out.result?.evidenceDimensions?.find((d) => d.key === "statistical_support");
    assert.equal(support?.grade, "unavailable");
    assert.match(support?.detail ?? "", /التحليل المباشر/);
    assertCompletePlan(out.result!);
  });

  it("costs ruin the current entry → a better price, not a distorted target", async () => {
    const weak = candidate({ netRr: 0.8, warnings: ["العائد الصافي للهدف الأول ضعيف"] });
    const out = await decide(
      { risk: makeRisk({ selectedCandidate: null, candidatesResult: { candidates: [weak], best: weak, rejectedReasons: [], hasReversalEvidence: false } }) },
      answer({
        planType: "conditional",
        proposedLevels: { entryLow: 3992, entryHigh: 3996, preferredEntry: 3992, stopLoss: 3990, targets: [4010] },
        activationCondition: "عودة السعر إلى 3992 حيث يغطي الهدف التكاليف.",
        activationRule: { kind: "price_touch", level: 3992, timeframe: "5m" },
      }),
    );
    assertCompletePlan(out.result!);
    // The better price came from the evidence menu, not from arithmetic.
    assert.equal(out.result?.recommendation.levelSource, "evidence_levels");
    assert.equal(out.result?.recommendation.entry, 3992);
  });

  it("imminent release → conditional plan with a short validity, never a veto", async () => {
    const out = await decide(
      {
        news: {
          newsRisk: "high",
          biasImpact: "unknown",
          affectedCurrencies: ["USD"],
          upcomingEvents: [],
          tradeAllowed: false,
          reason: "CPI in 7 minutes",
        },
      },
      answer({
        planType: "conditional",
        // The trigger has to sit ABOVE the fixture's 4000: a validator added
        // after this scenario was written refuses a condition that is already
        // true, and "close above 3996" was true the moment it was written. The
        // scenario is unchanged — wait out the first move, then act on
        // confirmation — only its level is now a condition rather than a
        // formality.
        activationCondition: "بعد انتهاء الحركة الأولى للخبر وإغلاق شمعة فوق 4006.",
        activationRule: { kind: "candle_close_above", level: 4006, timeframe: "5m" },
        validityCandles: 3,
      }),
    );
    assertCompletePlan(out.result!);
    assert.equal(out.result?.planType, "conditional");
    assert.equal(out.result?.recommendation.validityCandles, 3);
    const news = out.result?.evidenceDimensions?.find((d) => d.key === "news_impact");
    assert.equal(news?.grade, "weak");
  });

  it("calendar unavailable → the gap is reported, events are never invented", async () => {
    const out = await decide({ news: null }, answer());
    const news = out.result?.evidenceDimensions?.find((d) => d.key === "news_impact");
    assert.equal(news?.grade, "unavailable");
    assert.match(news?.detail ?? "", /غير متاح/);
  });

  it("unclassified structure → described and planned, with no invented pattern name", async () => {
    const out = await decide(
      {},
      answer({
        keyReasons: ["بنية غير مصنفة: قمم متساوية فوق قيعان صاعدة"],
        decisionTrace: {
          hypotheses: [{ scenario: "ضغط صاعد داخل بنية هجينة", supporting: ["قيعان صاعدة"], opposing: [] }],
          chosenBecause: "البنية غير مصنفة لكنها تضغط لأعلى.",
          planTypeBecause: "لا تأكيد بعد.",
        },
      }),
    );
    assertCompletePlan(out.result!);
    const pattern = out.result?.evidenceDimensions?.find((d) => d.key === "pattern_state");
    assert.equal(pattern?.grade, "unavailable");
    assert.match(pattern?.detail ?? "", /البنية موصوفة كما هي/);
  });

  it("thin coverage → reported as weak data, and the plan still says what it is", async () => {
    const out = await decide(
      { market: market({ dataQuality: { currentTfCount: 80, higherTfCount: 40, dailyCount: 20, sufficient: false, policyVersion: "1.2.0" } as AgentMarketContext["dataQuality"] }) },
      answer(),
    );
    assertCompletePlan(out.result!);
    const data = out.result?.evidenceDimensions?.find((d) => d.key === "data_quality");
    assert.equal(data?.grade, "weak");
    // Without confirmed levels a trade-grade confidence must not be implied.
    assert.equal(out.result?.confidenceSemantics.recommendationConfidence, "not_applicable");
  });

  it("a model answer with no direction is a contract fault, not a wait", async () => {
    const out = await decide({}, answer({ direction: null }));
    assert.equal(out.result, null);
    assert.equal(out.failure?.kind, "schema_mismatch");
    assert.equal(out.failure?.retryable, true);
  });
});

describe("visual evidence", () => {
  it("attaches each chart to its own timeframe and numbers", async () => {
    const { buildVisualBlocks } = await import(
      "@/lib/agent/agents/finalDecisionSynthesizer"
    );
    const blocks = buildVisualBlocks([
      { timeframe: "5m", imageBase64: "AAAA", numericContext: { price: 4000 } },
      { timeframe: "1h", imageBase64: "BBBB", numericContext: { price: 4001 } },
    ]);
    // label, image, label, image — an unlabelled batch would leave the model
    // guessing which chart is which, and a wrong binding is worse than none.
    assert.equal(blocks.length, 4);
    assert.equal(blocks[0]!.type, "text");
    assert.equal(blocks[1]!.type, "image");
    const label = JSON.parse((blocks[0] as { text: string }).text);
    assert.equal(label.chart_timeframe, "5m");
    assert.equal(label.numeric_context.price, 4000);
    assert.match(label.note, /never from the pixels/);
    assert.equal((blocks[3] as { source: { data: string } }).source.data, "BBBB");
  });

  it("skips snapshots that carry no image rather than sending an empty block", async () => {
    const { buildVisualBlocks } = await import(
      "@/lib/agent/agents/finalDecisionSynthesizer"
    );
    assert.deepEqual(buildVisualBlocks([{ timeframe: "5m", imageBase64: "" }]), []);
  });

  it("picks the timeframes worth showing for the frame being traded", async () => {
    const { visualTimeframesFor } = await import("@/lib/agent/visualEvidence");
    assert.deepEqual(visualTimeframesFor("5m"), ["5m", "15m", "1h"]);
    assert.deepEqual(visualTimeframesFor("1h"), ["1h", "4h", "1d"]);
    // An unknown frame still yields a sane, bounded set rather than nothing.
    assert.equal(visualTimeframesFor("weird").length, 3);
  });

  it("reports timeframe roles when the model resolves a conflict", async () => {
    const out = await decide(
      {
        mtf: {
          conflict: true,
          currentBias: "bullish",
          higherBias: "bearish",
          dailyBias: "bearish",
        } as unknown as FinalDecisionInput["mtf"],
      },
      answer({ timeframeRoles: { lead: "15m", context: "4h", timing: "5m" } }),
    );
    assert.equal(out.result?.timeframeRoles?.lead, "15m");
    assert.equal(out.result?.timeframeRoles?.context, "4h");
  });
});
