/**
 * Cards, derived.
 *
 * One pure function from the result the orchestrator already produces to the
 * cards both surfaces render. It reads; it never decides, never re-computes a
 * number, and never invents a field. If a card is missing from an answer, the
 * data behind it was missing from the run — which is the only honest reason for
 * a card to be absent.
 *
 * ## Why derivation rather than authoring
 *
 * The deleted `cardComposer` asked the MODEL to emit a `ui_schema`. That makes
 * every card optional in practice: a card type is only as reliable as the
 * model's memory of it, and a card that fails to appear looks exactly like a
 * card whose data was absent. Deriving them from the result makes presence a
 * property of the data, testable without a model in the loop.
 *
 * ## The empty-card rule
 *
 * Every branch below refuses to emit a card it cannot fill. An empty risk-
 * warnings card says "no risks", which is a claim; absence says nothing, which
 * is the truth. This is the same rule `getEvidenceCard` follows in returning
 * null rather than a card of zeros.
 */
import type { AgentFinalResult } from "../types";
import { CARD_ORDER, type AgentCard, type CardKind } from "./types";

/** Read a number out of the serialized cost record without trusting its shape. */
function num(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Build every card this result can support.
 *
 * Returned in `CARD_ORDER`, which is the reading order on both surfaces: what
 * was decided, then the plan, then why, then what it rests on, then how it was
 * produced.
 */
export function deriveCards(result: AgentFinalResult): AgentCard[] {
  const cards: AgentCard[] = [];
  const rec = result.recommendation;

  // Leads the reading order: every card below is a scenario for the next
  // open, and the operator must know that before the plan, not after.
  if (result.marketClosedScenario) {
    cards.push({
      kind: "scenario_notice",
      nextOpenAt: result.marketClosedScenario.nextOpenAt,
      reasonAr: result.marketClosedScenario.reasonAr,
    });
  }

  cards.push({
    kind: "decision",
    decision: result.decision,
    summary: result.summary,
    confidence: result.confidence,
    semantics: result.confidenceSemantics,
  });

  // A plan needs all three of its numbers. Two of them is not a partial plan,
  // it is an unactionable one, and rendering it would invite acting on it.
  if (
    rec &&
    (rec.action === "buy" || rec.action === "sell") &&
    rec.entry != null &&
    rec.stop_loss != null &&
    (rec.targets?.length ?? 0) > 0
  ) {
    cards.push({
      kind: "plan_levels",
      direction: rec.action,
      entry: rec.entry,
      entryZone: rec.entryZone,
      stopLoss: rec.stop_loss,
      targets: rec.targets!,
      // netRr, not the gross figure: reward:risk before costs flatters every
      // plan and is the number an operator cannot actually obtain.
      netRr: rec.netRr,
      entryType: rec.entryType,
      levelSource: rec.levelSource,
    });

    if (rec.activationClass) {
      cards.push({
        kind: "activation",
        activationClass: rec.activationClass,
        triggerCondition: rec.triggerCondition,
        validityCandles: rec.validityCandles,
        executionState: rec.executionState,
      });
    }

    if (rec.invalidationLevel != null || rec.invalidationRule) {
      cards.push({
        kind: "invalidation",
        level: rec.invalidationLevel,
        rule: rec.invalidationRule,
      });
    }

    if (rec.alternativeScenario) {
      cards.push({ kind: "alternative_scenario", scenario: rec.alternativeScenario });
    }
  }

  // Shown on a pass as well as a refusal. A checklist that appears only when it
  // blocks teaches the operator that gates are bad news rather than that they
  // ran on every answer.
  if (result.gateVerdicts?.length) {
    const vetoed = result.gateVerdicts.find(
      (v) => v.status === "veto" || v.status === "unavailable",
    );
    const allowed = result.gateVerdicts.every((v) => v.status === "pass");
    cards.push({
      kind: "gate_checklist",
      verdicts: result.gateVerdicts,
      allowed,
      vetoedBy: allowed ? undefined : vetoed?.id,
    });
  }

  if (result.keyReasons?.length) {
    cards.push({ kind: "key_reasons", reasons: result.keyReasons });
  }
  if (result.publicReasoningSummary?.length) {
    cards.push({ kind: "public_reasoning", points: result.publicReasoningSummary });
  }
  if (result.decisionTrace?.hypotheses?.length) {
    cards.push({ kind: "decision_trace", trace: result.decisionTrace });
  }
  if (result.evidenceCard) {
    cards.push({ kind: "evidence_strategy", card: result.evidenceCard });
  }
  if (result.evidenceDimensions?.length) {
    cards.push({ kind: "evidence_dimensions", dimensions: result.evidenceDimensions });
  }
  if (result.riskWarnings?.length) {
    cards.push({ kind: "risk_warnings", warnings: result.riskWarnings });
  }
  // "unknown" is a real state worth showing — it says the calendar was not
  // readable, which is different from saying the window is quiet.
  if (result.newsRisk) {
    cards.push({ kind: "news_risk", risk: result.newsRisk });
  }

  if (result.costEvidence) {
    const cost = result.costEvidence;
    const spread = num(cost, "observed_spread_pips") ?? num(cost, "expected_spread_pips");
    // A cost card with no pips figure is a heading. `unavailable` cost evidence
    // is the case this guards: it must never render as a free fill.
    if (spread != null) {
      cards.push({
        kind: "cost_evidence",
        spreadPips: spread,
        source: str(cost, "source"),
        session: str(cost, "session"),
        fallbackUsed: cost.fallback_used === true,
        fallbackReason: str(cost, "fallback_reason"),
      });
    }
  }

  const research = result.researchEvidence;
  if (research && (research.usedSystems?.length || research.skippedSystems?.length)) {
    cards.push({
      kind: "research_evidence",
      summaryAr: research.summaryAr,
      summaryEn: research.summaryEn,
      used: research.usedSystems ?? [],
      skipped: (research.skippedSystems ?? []).map((s) => ({
        system: s.system,
        reason: s.reason,
      })),
    });
  }

  if (result.evidenceTimeline?.length) {
    cards.push({ kind: "evidence_timeline", steps: result.evidenceTimeline });
  }
  if (result.candleCoverage) {
    cards.push({ kind: "candle_coverage", report: result.candleCoverage });
  }
  if (result.activeRecommendation) {
    cards.push({ kind: "tracked_recommendation", ...result.activeRecommendation });
  }

  // Only when it is not a clean success: an envelope card on every good answer
  // is noise that trains the operator to skip the one that matters.
  if (result.envelope && result.envelope.outcome_class !== "execution_validated") {
    cards.push({ kind: "envelope_status", envelope: result.envelope });
  }

  if (result.selectedSkills?.length || result.skillLoadFailures?.length) {
    cards.push({
      kind: "skills_used",
      loaded: result.selectedSkills ?? [],
      failed: result.skillLoadFailures ?? [],
    });
  }
  if (result.stages?.length) {
    cards.push({ kind: "run_stages", stages: result.stages });
  }
  if (result.options?.length) {
    cards.push({ kind: "follow_up_options", options: result.options });
  }

  const rank = new Map<CardKind, number>(CARD_ORDER.map((kind, i) => [kind, i]));
  return cards.sort((a, b) => (rank.get(a.kind) ?? 0) - (rank.get(b.kind) ?? 0));
}
