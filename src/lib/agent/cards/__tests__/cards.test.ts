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
import {
  renderCardForTelegram,
  renderCardsForTelegram,
  renderTelegramDetails,
  renderTelegramLead,
  scrubTelegramInternals,
} from "@/lib/agent/cards/telegramCards";
import {
  CARD_ORDER,
  COLLAPSED_BY_DEFAULT,
  EXPECTED_CARD_TYPES,
  assertNeverCard,
  type AgentCard,
  type CardKind,
} from "@/lib/agent/cards/types";
import {
  invalidationDisplay,
  isPlaceholderGateLabel,
  visibleGateVerdicts,
} from "@/lib/agent/cards/reportPresentation";
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
    assert.ok(openText.startsWith("<b>TL;DR:</b>"), "mid-session the TL;DR leads");
    assert.ok(openText.includes("<b>شراء</b>"), "the decision is in the lead");
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

describe("the lead card and the folded depth (the phone's reading order)", () => {
  it("opens the lead with a compact TL;DR before the plan", () => {
    const lead = renderTelegramLead(
      deriveCards(fullResult({ marketClosedScenario: undefined })),
      "ar",
    );
    const tldrAt = lead.indexOf("<b>TL;DR:</b>");
    const planAt = lead.indexOf("الخطة");
    assert.ok(tldrAt === 0, "TL;DR is the first thing the operator reads");
    assert.ok(planAt > tldrAt, "the plan section still follows");
    for (const line of ["الاتجاه", "الدخول", "الوقف", "الهدف", "العائد/المخاطرة", "الأطروحة", "الإبطال"]) {
      assert.ok(lead.includes(line), `TL;DR must name ${line}`);
    }
    assert.ok(lead.includes("🟢"), "buy is marked");
    assert.ok(lead.includes("4000"), "entry is the real number");
    assert.ok(lead.includes("3980"), "stop is the real number");
    assert.ok(lead.includes("4040"), "first target is the real number");
    assert.ok(lead.includes("1.80"), "net R:R is the real number");
    assert.ok(lead.includes("شراء من منطقة الطلب"), "the thesis keeps the summary sentence");
    assert.ok(!lead.includes("<blockquote"), "the TL;DR is always visible, never folded");
  });

  it("does not treat a price decimal as a sentence cut in the thesis", () => {
    const lead = renderTelegramLead(
      deriveCards(
        fullResult({
          marketClosedScenario: undefined,
          summary: "بيع من إعادة اختبار المقاومة عند 4696.9 مع ضعف الزخم.",
        }),
      ),
      "ar",
    );
    assert.ok(
      lead.includes("بيع من إعادة اختبار المقاومة عند 4696.9 مع ضعف الزخم"),
      "4696.9 must survive the thesis one-liner",
    );
  });

  it("omits the TL;DR on a talk-only informational card", () => {
    const text = renderCardsForTelegram(
      deriveCards(
        fullResult({
          decision: "informational",
          summary: "أهلاً — كيف أساعدك؟",
          recommendation: undefined,
        }),
      ),
      "ar",
    );
    assert.ok(!text.includes("TL;DR"));
    assert.ok(text.includes("أهلاً — كيف أساعدك؟"));
  });
  it("leads with what the operator acts on, folds the rest into expandable quotes", () => {
    const text = renderCardsForTelegram(
      deriveCards(fullResult({ marketClosedScenario: undefined })),
      "ar",
    );
    const firstFold = text.indexOf("<blockquote expandable>");
    assert.ok(firstFold > 0, "the long sections must be folded");
    const lead = text.slice(0, firstFold);
    // Everything needed to ACT is visible before the first fold.
    for (const visible of ["<b>شراء</b>", "الخطة", "الدخول", "الوقف", "الأهداف", "التفعيل", "ما يُبطل الخطة"]) {
      assert.ok(lead.includes(visible), `${visible} must be visible without a tap`);
    }
    // The depth — reasons, evidence, warnings, checks, alternative — is folded.
    const folded = text.slice(firstFold);
    for (const fold of ["الأسباب", "الأدلة", "تنبيهات", "الفحوصات", "السيناريو البديل"]) {
      assert.ok(folded.includes(fold), `${fold} belongs in the folded depth`);
    }
    // Every fold closes — an unbalanced quote 400s the whole send.
    assert.equal(
      (text.match(/<blockquote expandable>/g) ?? []).length,
      (text.match(/<\/blockquote>/g) ?? []).length,
    );
  });

  it("the lead alone fits a photo caption's shape: no folds inside it", () => {
    const cards = deriveCards(fullResult());
    const lead = renderTelegramLead(cards, "ar");
    assert.ok(lead.includes("الخطة"), "the caption carries the plan");
    assert.ok(!lead.includes("<blockquote"), "a caption cannot fold");
    const details = renderTelegramDetails(cards, "ar");
    assert.ok(details.startsWith("<blockquote expandable>"), "details are all folds");
    assert.ok(details.includes("الأسباب"));
  });

  it("an empty section renders no fold — a heading with nothing under it", () => {
    const details = renderTelegramDetails(
      deriveCards(
        fullResult({
          keyReasons: [],
          publicReasoningSummary: [],
          riskWarnings: [],
          newsRisk: undefined,
        }),
      ),
      "ar",
    );
    assert.ok(!details.includes("الأسباب"), "no reasons — no reasons fold");
    assert.ok(!details.includes("تنبيهات"), "no warnings — no warnings fold");
    assert.ok(details.includes("الفحوصات"), "sections with data still fold in");
  });
});

describe("internals never reach the phone (each pattern is a real transcript)", () => {
  it("scrubs candidate ids, shortens UUIDs, drops parroted decision enums", () => {
    assert.equal(
      scrubTelegramInternals("تنبيه على الخطة (tc-15) بعد الإغلاق"),
      "تنبيه على الخطة بعد الإغلاق",
    );
    assert.equal(
      scrubTelegramInternals("توصية #c438afb4-f73c-4095-b939-1a10d419d61a قائمة"),
      "توصية #c438afb4 قائمة",
    );
    assert.equal(
      scrubTelegramInternals("أهلاً. Decision: informational كيف أساعدك؟"),
      "أهلاً. كيف أساعدك؟",
    );
  });

  it("a removed gate's placeholder verdict simply does not render", () => {
    const result = fullResult({
      gateVerdicts: [
        { id: "G1", name: "news", status: "pass", startedAt: 1, finishedAt: 2 },
        { id: "G5", name: "removed", status: "pass", startedAt: 2, finishedAt: 2 },
        { id: "G6", name: "risk_geometry", status: "pass", startedAt: 2, finishedAt: 3 },
      ] as AgentFinalResult["gateVerdicts"],
    });
    const text = renderCardsForTelegram(deriveCards(result), "ar");
    assert.ok(!text.includes("أُزيل"), "the relic gate's label must never render");
    assert.ok(!text.includes("✅ Removed"), "nor its English label");
    assert.ok(text.includes("الأخبار والأحداث الاقتصادية"), "real gates still render");

    const card = deriveCards(result).find((c) => c.kind === "gate_checklist");
    assert.ok(card && card.kind === "gate_checklist");
    const visible = visibleGateVerdicts(card.verdicts);
    assert.deepEqual(
      visible.map((v) => v.id),
      ["G1", "G6"],
      "the platform report drops the relic slot too",
    );
    assert.equal(isPlaceholderGateLabel("أُزيل"), true);
    assert.equal(isPlaceholderGateLabel("Removed"), true);
    assert.equal(isPlaceholderGateLabel("الأخبار والأحداث الاقتصادية"), false);
  });

  it("invalidation prints the rule once — never the price twice", () => {
    assert.deepEqual(invalidationDisplay("إغلاق تحت 3975", 3975), {
      statement: "إغلاق تحت 3975",
      price: null,
    });
    assert.deepEqual(invalidationDisplay("إغلاق تحت 4612.76", 4612.76), {
      statement: "إغلاق تحت 4612.76",
      price: null,
    });
    assert.deepEqual(invalidationDisplay("كسر قاع الجلسة", 4612.76), {
      statement: "كسر قاع الجلسة",
      price: "4612.76",
    });
    assert.deepEqual(invalidationDisplay(undefined, 3975), {
      statement: null,
      price: "3975.00",
    });
  });

  it("evidence renders as graded human sentences, never key:value dumps", () => {
    const result = fullResult({
      evidenceDimensions: [
        { key: "signal_strength", grade: "weak", detail: "قوة الإشارة الحالية 42%.", value: 42 },
        { key: "cot_positioning", grade: "moderate", detail: "تموضع المضاربين ضمن نطاقه المعتاد." },
        { key: "plan_type", grade: "moderate", detail: "خطة مشروطة — تنتظر شرط التفعيل." },
      ] as AgentFinalResult["evidenceDimensions"],
    });
    const text = renderCardsForTelegram(deriveCards(result), "ar");
    for (const machineKey of ["signal_strength", "cot_positioning", "plan_type"]) {
      assert.ok(!text.includes(machineKey), `${machineKey} is a lookup handle, not an answer`);
    }
    assert.ok(text.includes("قوة الإشارة الحالية 42%"), "the human sentence survives");
    assert.ok(text.includes("🔴"), "the grade rides as a mark");
  });

  it("the news level renders in the reader's language, never the raw enum", () => {
    const text = renderCardsForTelegram(deriveCards(fullResult()), "ar");
    assert.ok(!/\bmedium\b/.test(text), "the raw level enum must not render");
    assert.ok(text.includes("متوسط"), "the level renders as a word");
  });

  it("the tracked status renders localized, never the raw snake_case", () => {
    const text = renderCardsForTelegram(
      deriveCards(
        fullResult({
          activeRecommendation: {
            id: "rec_1",
            status: "pending_entry",
            direction: "buy",
            symbol: "XAUUSD",
            interval: "15m",
          },
        }),
      ),
      "ar",
    );
    assert.ok(!text.includes("pending_entry"));
    assert.ok(text.includes("تُفعَّل عند منطقة الدخول"));
  });

  it("a full recommendation message carries no UUID, no Decision:, no tc-N", () => {
    const text = renderCardsForTelegram(
      deriveCards(
        fullResult({
          summary: "بيع مشروط (tc-15) — Decision: sell",
          keyReasons: ["السيولة أعلى — راجع توصية #c438afb4-f73c-4095-b939-1a10d419d61a"],
        }),
      ),
      "ar",
    );
    assert.doesNotMatch(
      text,
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      "a full UUID is an internal identifier",
    );
    assert.ok(!text.includes("Decision:"), "the decision enum line must not render");
    assert.doesNotMatch(text, /\btc-\d+\b/, "candidate ids are internal vocabulary");
    assert.ok(text.includes("#c438afb4"), "the short id remains as the honest reference");
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

  it("the report button opens a modal, not an in-chat expansion", () => {
    const view = readFileSync(
      path.join(SRC, "components", "agent", "cards", "AgentCards.tsx"),
      "utf8",
    );
    const report = readFileSync(
      path.join(SRC, "components", "agent", "cards", "RecommendationReport.tsx"),
      "utf8",
    );
    assert.match(view, /agent\.signal\.show_report/);
    assert.match(view, /Dialog\.Root/);
    assert.match(report, /recommendation-report-modal/);
    assert.match(report, /recommendation-report-close/);
    assert.doesNotMatch(
      view + report,
      /LiquidMetalFrame/,
      "the report is a document, not a liquid-metal gadget",
    );
    assert.doesNotMatch(
      report,
      /metal-chip/,
      "report chrome is not metal-chip",
    );
    assert.doesNotMatch(
      view,
      /data-testid="agent-cards-details"/,
      "the report must not expand inside the chat thread",
    );
  });

  it("the report document is responsive: sheet on mobile, two columns from tablet", () => {
    const report = readFileSync(
      path.join(SRC, "components", "agent", "cards", "RecommendationReport.tsx"),
      "utf8",
    );
    assert.match(report, /left-0 right-0 top-auto bottom-0/);
    assert.match(report, /md:left-1\/2/);
    assert.match(report, /md:grid-cols-2/);
    assert.match(report, /lg:w-\[min\(100%-2rem,56rem\)\]/);
    assert.match(report, /flex-wrap gap-2/);
    assert.match(report, /grid-cols-2 gap-x-4 gap-y-3/);
    assert.match(report, /visibleGateVerdicts/);
    assert.match(report, /isPlaceholderGateLabel/);
    assert.match(report, /invalidationDisplay/);
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
