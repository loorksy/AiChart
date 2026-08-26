/**
 * Turn presentation — cards or plain talk, decided ONCE.
 *
 * The complaint this exists for: every reply, including a bare greeting,
 * rendered the full recommendation-status card ("no recommendation now", a 0%
 * strength meter, a "what was the plan?" button) plus a compliance pill and a
 * chip stack. The
 * orchestrator already knows how each turn was routed (`turnMode`, stamped
 * from core/turnPlanner.ts); this module is the ONE place that translates
 * that routing into a rendering contract:
 *
 *   - conversation / specialist turns → plain text. No signal card, no
 *     decision header, no envelope note, no trace row. A greeting is a
 *     sentence, not a dashboard.
 *   - full_analysis / supersede_analysis / recommendation_followup → the
 *     card treatment they always had.
 *   - an operational blocker keeps its fault card REGARDLESS of mode — a
 *     failure must never be dressed down into a friendly sentence.
 *
 * Results persisted before `turnMode` existed carry no mode. For those the
 * fallback is conservative in one direction only: anything that LOOKS like an
 * analysis (a recommendation, gate verdicts, a tracked plan, market-closed
 * scenario, evidence) keeps its cards; only a bare informational answer with
 * none of that renders plain. A real analysis can never lose its cards to
 * this fallback — only old smalltalk loses its noise.
 *
 * Pure and client-safe on purpose: the web panel, the card renderer, and the
 * server tests all import THIS, so the two sides cannot disagree about what a
 * conversational reply looks like.
 */
import type { AgentFinalResult } from "./types";

/** The subset of a result the presentation decision reads. */
export type TurnPresentationInput = Pick<
  AgentFinalResult,
  | "turnMode"
  | "decision"
  | "envelope"
  | "recommendation"
  | "activeRecommendation"
  | "gateVerdicts"
  | "marketClosedScenario"
  | "evidenceCard"
  | "evidenceDimensions"
>;

const PLAIN_MODES = new Set(["conversation", "specialist"]);

/**
 * True when this result renders as plain conversational text — no signal
 * hero, no decision header, no envelope note, no per-message chrome.
 */
export function isPlainTalkResult(
  result: TurnPresentationInput | null | undefined,
): boolean {
  if (!result) return false;
  // A fault stays a fault: the blocker card carries the trace id the operator
  // quotes to support, and hiding it behind "plain talk" would orphan that.
  if (result.envelope?.outcome_class === "operational_blocker") return false;
  if (result.turnMode) return PLAIN_MODES.has(result.turnMode);
  // Legacy result (persisted before turnMode existed): plain only when
  // NOTHING analysis-shaped is attached. Any doubt keeps the cards.
  return (
    result.decision === "informational" &&
    !result.recommendation &&
    !result.activeRecommendation &&
    !(result.gateVerdicts?.length ?? 0) &&
    !result.marketClosedScenario &&
    !result.evidenceCard &&
    !(result.evidenceDimensions?.length ?? 0)
  );
}
