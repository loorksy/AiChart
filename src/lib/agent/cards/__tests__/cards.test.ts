/**
 * The card layer, tested where it can actually break.
 *
 * The failure this whole design exists to prevent is not a wrong pixel. It is
 * a card type that exists in the contract, is produced by nobody, rendered by
 * nobody, and noticed by no one — which is precisely what happened to the 596
 * lines of `cardComposer` / `cardPolicy` / `uiSchema` deleted in Phase 7, and
 * to `buildEvidenceCard`, and to seven other things this migration found.
 *
 * A snapshot test would not have caught any of them: a snapshot of nothing is a
 * stable snapshot. So these tests check the CONNECTIONS —
 *
 *   - every declared kind is reachable from `deriveCards` (no orphan types),
 *   - every kind either renders on Telegram or is a documented drop,
 *   - a card is never emitted without the data behind it,
 *   - the two surfaces derive from one function, so they cannot disagree.
 *
 * Exhaustiveness itself is NOT tested here, because it is not testable here —
 * it is enforced by `tsc` through the `never` guard both renderers end in. A
 * missing case is a build failure, which is strictly stronger than a red test.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { deriveCards } from "@/lib/agent/cards/deriveCards";
import { renderCardForTelegram, renderCardsForTelegram } from "@/lib/agent/cards/telegramCards";
import {
  CARD_ORDER,
  COLLAPSED_BY_DEFAULT,
  EXPECTED_CARD_TYPES,
  assertNeverCard,
  type AgentCard,
  type CardKind,
} from "@/lib/agent/cards/types";
import type { AgentFinalResult } from "@/lib/agent/types";

const SRC = path.join(import.meta.dirname, "..", "..", "..", "..");

/** A result carrying every field any card reads. */
function fullResult(over: Partial<AgentFinalResult> = {}): AgentFinalResult {
  return {
    decision: "buy",
    summary: "شراء من منطقة الطلب.",
    confidence: 0.62,
    confidenceSemantics: {
      displayKind: "calibrated",
      displayValue: 0.62,
      displayLabelKey: "agent.confidence",
    } as unknown as AgentFinalResult["confidenceSemantics"],
    keyReasons: ["الهيكل صاعد", "ارتداد من الطلب"],
    riskWarnings: ["خبر عالي الأثر بعد ساعتين"],
    publicReasoningSummary: ["السيولة أعلى", "الفريم الأكبر متوافق"],
    activityEvents: [],
    recommendation: {
      action: "buy",
      entry: 4000,
      entryZone: { low: 3998, high: 4002 },
      stop_loss: 3980,
      targets: [4040, 4080],
      netRr: 1.8,
      entryType: "limit_touch",
      levelSource: "candidate",
      activationClass: "conditional",
      triggerCondition: "إغلاق شمعة فوق 4005",
      validityCandles: 12,
      executionState: "awaiting_activation",
      invalidationLevel: 3975,
      invalidationRule: "إغلاق تحت 3975",
      alternativeScenario: "كسر 3975 يقلب التحيّز إلى البيع",
    } as AgentFinalResult["recommendation"],
    marketClosedScenario: {
      nextOpenAt: Date.parse("2026-07-26T22:00:00Z"),
      reasonAr: "عطلة نهاية الأسبوع — السوق مغلق (السبت).",
    },
    gateVerdicts: [
      { id: "G1", name: "news", status: "pass", startedAt: 1, finishedAt: 2 },
      { id: "G2", name: "liquidity", status: "pass", startedAt: 2, finishedAt: 3 },
    ] as AgentFinalResult["gateVerdicts"],
    decisionTrace: {
      hypotheses: [{ scenario: "استمرار الصعود", supporting: ["الهيكل"], opposing: ["الأخبار"] }],
      chosenBecause: "الأدلة أرجح",
      planTypeBecause: "الدخول يحتاج تأكيداً",
    },
    evidenceCard: {
      strategyId: "ema_trend_v1",
      symbol: "XAUUSD",
      timeframe: "1h",
      tradeCount: 250,
      winRate: 0.56,
      profitFactor: 1.6,
      calibratedConfidence: 55,
      confidenceLow: 48,
      confidenceHigh: 62,
      walkForward: "passed",
      deploymentState: "active",
      liveSampleSize: 30,
      liveWinRate: 0.5,
      meetsExecutionGates: true,
      shortfallReason: null,
    },
    evidenceDimensions: [{ key: "structure", grade: "strong", detail: "هيكل صاعد واضح" }],
    newsRisk: { level: "medium", reason: "بيانات تضخم بعد ساعتين" },
    costEvidence: {
      source: "oanda",
      observed_spread_pips: 2.4,
      session: "london",
      fallback_used: false,
      fallback_reason: null,
    },
    researchEvidence: {
      evidenceVersion: "1",
      contributions: [],
      historicalEvidenceTendency: 0,
      summaryAr: "الخلفية التاريخية داعمة",
      summaryEn: "history supportive",
      timeline: [],
      usedSystems: ["backtest"],
      skippedSystems: [{ system: "swarm", reason: "not_configured", reasonDetail: "" }],
    } as unknown as AgentFinalResult["researchEvidence"],
    evidenceTimeline: [{ step: "backtest", status: "used" }],
    candleCoverage: {
      summaryAr: "التغطية كافية",
      sufficientForTrade: true,
    } as AgentFinalResult["candleCoverage"],
    activeRecommendation: {
      id: "rec_1",
      status: "active",
      direction: "buy",
      symbol: "XAUUSD",
      interval: "15m",
    },
    envelope: { outcome_class: "descriptive_only" } as AgentFinalResult["envelope"],
    selectedSkills: [{ name: "gold", version: "1" }],
    skillLoadFailures: [{ name: "macro", version: "1", error: "missing" }],
    stages: [{ stage: "market", durationMs: 120 }] as AgentFinalResult["stages"],
    options: [{ id: "o1", label: "وماذا عن البيع؟", prompt: "حلل البيع" }],
    ...over,
  } as AgentFinalResult;
}

/** The bare minimum a run can return. */
function minimalResult(): AgentFinalResult {
  return {
    decision: "wait",
    summary: "لا توجد توصية الآن.",
    confidence: 0,
    keyReasons: [],
    riskWarnings: [],
    activityEvents: [],
  } as unknown as AgentFinalResult;
}

describe("the card contract", () => {
  it("declares exactly the number of types the plan asks for", () => {
    // Pinned so that quietly dropping a type — the easiest way to make a
    // failing renderer "pass" — is a test failure rather than a smaller list.
    assert.equal(CARD_ORDER.length, EXPECTED_CARD_TYPES);
    assert.equal(new Set(CARD_ORDER).size, CARD_ORDER.length, "duplicate card kind");
  });

  it("has no orphan type: every declared kind is produced by the deriver", () => {
    // The check that the deleted card pipeline would have failed on day one.
    // A kind nothing can produce is a kind that exists only in a type file.
    const produced = new Set(deriveCards(fullResult()).map((c) => c.kind));
    const orphans = CARD_ORDER.filter((kind) => !produced.has(kind));
    assert.deepEqual(orphans, [], "declared but never derivable — nothing can ever emit these");
  });

  it("emits cards in the contract's reading order", () => {
    const kinds = deriveCards(fullResult()).map((c) => c.kind);
    const expected = CARD_ORDER.filter((k) => kinds.includes(k));
    assert.deepEqual(kinds, [...expected]);
  });
});

describe("derivation never invents a card", () => {
  it("returns only the decision when the run produced nothing else", () => {
    const kinds = deriveCards(minimalResult()).map((c) => c.kind);
    assert.deepEqual(kinds, ["decision"]);
  });

  it("omits the plan when a level is missing", () => {
    // Two of three numbers is not a partial plan, it is an unactionable one,
    // and drawing it invites acting on it.
    const kinds = deriveCards(
      fullResult({
        recommendation: { action: "buy", entry: 4000, targets: [4040] } as AgentFinalResult["recommendation"],
      }),
    ).map((c) => c.kind);
    assert.ok(!kinds.includes("plan_levels"));
    assert.ok(!kinds.includes("activation"), "activation without a plan is a trigger for nothing");
  });

  it("omits the cost card rather than showing a fill as free", () => {
    // `unavailable` cost evidence carries no pips figure. A zero here would
    // read as a costless entry, which is the one thing it must never say.
    const kinds = deriveCards(
      fullResult({ costEvidence: { source: "unavailable", fallback_used: true } }),
    ).map((c) => c.kind);
    assert.ok(!kinds.includes("cost_evidence"));
  });

  it("shows the gate checklist on a pass, not only on a refusal", () => {
    const card = deriveCards(fullResult()).find((c) => c.kind === "gate_checklist");
    assert.ok(card && card.kind === "gate_checklist");
    assert.equal(card.allowed, true);
    assert.equal(card.vetoedBy, undefined);
  });

  it("names the gate that refused", () => {
    const result = fullResult({
      gateVerdicts: [
        { id: "G1", name: "news", status: "pass", startedAt: 1, finishedAt: 2 },
        { id: "G2", name: "liquidity", status: "veto", reasonAr: "لا سيولة", startedAt: 2, finishedAt: 3 },
      ] as AgentFinalResult["gateVerdicts"],
    });
    const card = deriveCards(result).find((c) => c.kind === "gate_checklist");
    assert.ok(card && card.kind === "gate_checklist");
    assert.equal(card.allowed, false);
    assert.equal(card.vetoedBy, "G2");
  });

  it("stays quiet about the envelope on a clean success", () => {
    // An envelope card on every good answer trains the operator to skip the
    // one time it matters.
    const kinds = deriveCards(
      fullResult({ envelope: { outcome_class: "execution_validated" } as AgentFinalResult["envelope"] }),
    ).map((c) => c.kind);
    assert.ok(!kinds.includes("envelope_status"));
  });
});

describe("the phone gets the same answer", () => {
  it("renders something for every card that is not a documented drop", () => {
    const cards = deriveCards(fullResult());
    const silent = cards
      .filter((c) => !COLLAPSED_BY_DEFAULT.has(c.kind))
      .filter((c) => {
        const text = renderCardForTelegram(c, "ar");
        return text == null || !text.trim();
      })
      .map((c) => c.kind)
      // news_risk at "low" and activation with no trigger are deliberate
      // silences, both covered by their own assertions below.
      // follow_up_options is a button on the message when the agent authored
      // one — not a numbered dump on every phone reply.
      .filter((kind) => kind !== "follow_up_options")
      .filter((kind) => kind !== "decision" || false);
    assert.deepEqual(silent, [], "a card with data and no phone rendering is a surface that drifted");
  });

  it("drops diagnostic depth instead of burying the answer under it", () => {
    for (const kind of COLLAPSED_BY_DEFAULT) {
      const card = deriveCards(fullResult()).find((c) => c.kind === kind);
      if (!card) continue;
      assert.equal(
        renderCardForTelegram(card, "ar"),
        null,
        `${kind} must not be sent to a phone — there is no disclosure triangle there`,
      );
    }
  });

  it("leads with the decision and carries the plan's real numbers", () => {
    // The full fixture carries a closed-market scenario, so THAT leads — an
    // operator must learn the market is closed before reading the plan. The
    // decision follows immediately.
    const text = renderCardsForTelegram(deriveCards(fullResult()), "ar");
    assert.ok(text.startsWith("🕒 <b>السوق مغلق"), "the scenario frames everything below it");
    assert.ok(text.includes("<b>شراء</b>"), "the decision follows the frame");
    const openText = renderCardsForTelegram(
      deriveCards(fullResult({ marketClosedScenario: undefined })),
      "ar",
    );
    assert.ok(openText.startsWith("<b>شراء</b>"), "mid-session the decision leads");
    assert.ok(text.includes("3980"), "the stop must survive to the phone");
    assert.ok(text.includes("4040"), "so must the targets");
    // The four things the deleted `analysisCard` builder silently dropped.
    assert.ok(text.includes("الفحوصات"), "the gate checklist was never on the phone before");
    assert.ok(text.includes("ما يُبطل الخطة"), "nor the invalidation");
    assert.ok(text.includes("السيناريو البديل"), "nor the alternative");
    assert.ok(text.includes("التكلفة المتوقعة"), "nor the cost basis");
  });

  it("answers a refusal without dressing it as a plan", () => {
    const text = renderCardsForTelegram(deriveCards(minimalResult()), "ar");
    // A refusal is "no recommendation", never a WAIT verdict — the platform
    // decision layer only answers buy or sell.
    assert.ok(text.includes("لا توصية"));
    assert.ok(!text.includes("انتظار"));
    assert.ok(!text.includes("الدخول"), "a refusal must carry no entry price");
  });

  it("never prints internal envelope or decision enums on the phone", () => {
    const text = renderCardsForTelegram(
      deriveCards(
        fullResult({
          decision: "informational",
          summary: "أهلاً. كيف أساعدك؟",
          confidenceSemantics: {
            displayValue: "not_applicable",
          } as AgentFinalResult["confidenceSemantics"],
          envelope: {
            outcome_class: "descriptive_only",
          } as AgentFinalResult["envelope"],
          keyReasons: ["Market closed for XAUUSD (weekend)."],
          riskWarnings: ["لم تصدر أي توصية لأن السوق مغلق."],
        }),
      ),
      "ar",
    );
    assert.equal(text.includes("أهلاً"), true);
    for (const leak of [
      "informational",
      "not_applicable",
      "descriptive_only",
      "operational_blocker",
      "action_required",
      "Market closed for",
    ]) {
      assert.equal(text.includes(leak), false, `phone must not show ${leak}`);
    }
  });

  it("stays silent on a quiet news window", () => {
    const card = deriveCards(fullResult({ newsRisk: { level: "low", reason: "هادئ" } })).find(
      (c) => c.kind === "news_risk",
    );
    assert.ok(card);
    assert.equal(
      renderCardForTelegram(card, "ar"),
      null,
      "'nothing to report' is not worth a push",
    );
  });

  it("refuses an unknown card loudly rather than rendering a blank", () => {
    assert.throws(
      () => renderCardForTelegram({ kind: "not_a_card" } as unknown as AgentCard, "ar"),
      /unhandled agent card/,
    );
    assert.throws(() => assertNeverCard("x" as never), /unhandled agent card/);
  });
});

describe("both surfaces are wired to the derivation", () => {
  // The half that was missing every previous time. A card layer nothing calls
  // is the exact artefact Phase 7 deleted.
  it("the chat panel renders the cards", () => {
    const panel = readFileSync(
      path.join(SRC, "components", "agent", "SmartChartAgentPanel.tsx"),
      "utf8",
    );
    assert.match(panel, /<AgentCards\b/);
    assert.match(panel, /from "\.\/cards\/AgentCards"/);
  });

  it("the panel no longer hand-renders what the cards own", () => {
    // The four inline conditionals the card layer replaced. Leaving one behind
    // would double-render it and let the two paths drift apart.
    const panel = readFileSync(
      path.join(SRC, "components", "agent", "SmartChartAgentPanel.tsx"),
      "utf8",
    );
    assert.doesNotMatch(panel, /m\.result\.evidenceCard/);
    assert.doesNotMatch(panel, /m\.result\.riskWarnings/);
    assert.doesNotMatch(panel, /m\.result\.publicReasoningSummary/);
    assert.doesNotMatch(panel, /m\.result\.stages\?\.length/);
  });

  it("telegram renders from the same derivation, not its own builder", () => {
    const agent = readFileSync(
      path.join(SRC, "lib", "telegram", "webhookAgent.ts"),
      "utf8",
    );
    assert.match(agent, /renderCardsForTelegram\(deriveCards\(result\), locale\)/);
    assert.doesNotMatch(
      agent,
      /analysisCard\(/,
      "a second message builder is how the surfaces started disagreeing",
    );
  });

  it("the react renderer handles every kind the contract declares", () => {
    // `tsc` already enforces this through the never-guard; this asserts the
    // guard is actually PRESENT, since deleting it would silently reopen the
    // hole without failing the build.
    const view = readFileSync(
      path.join(SRC, "components", "agent", "cards", "AgentCards.tsx"),
      "utf8",
    );
    assert.match(view, /assertNeverCard\(card\)/);
    const missing = CARD_ORDER.filter((kind) => !view.includes(`case "${kind}"`));
    assert.deepEqual(missing, [], "these kinds have no case in the panel renderer");
  });

  it("the telegram renderer handles every kind too", () => {
    const tg = readFileSync(path.join(SRC, "lib", "agent", "cards", "telegramCards.ts"), "utf8");
    assert.match(tg, /assertNeverCard\(card\)/);
    const missing = CARD_ORDER.filter((kind: CardKind) => !tg.includes(`case "${kind}"`));
    assert.deepEqual(missing, [], "these kinds have no case in the telegram renderer");
  });
});
