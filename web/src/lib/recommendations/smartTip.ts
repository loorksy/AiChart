/**
 * Deterministic Smart Tip selection (no LLM). Maps a recommendation's terminal
 * outcome or live status to an i18n tip key. Terminal outcome wins over status.
 */
import type {
  TrackedRecommendationOutcome,
  TrackedRecommendationStatus,
} from "./types";

export function smartTipKey(rec: {
  status: TrackedRecommendationStatus;
  outcome: TrackedRecommendationOutcome;
}): string {
  switch (rec.outcome) {
    case "cancelled":
      return "rec.tip.cancelled";
    case "invalidated":
      return "rec.tip.invalidated";
    case "expired":
      return "rec.tip.expired";
    case "loss":
      return "rec.tip.sl";
    case "win_tp3":
      return "rec.tip.tp3";
    case "win_tp2":
      return "rec.tip.tp2";
    case "win_tp1":
      return "rec.tip.tp1";
    default:
      break; // pending → fall through to live status
  }
  switch (rec.status) {
    case "tp2_hit":
      return "rec.tip.tp2";
    case "tp1_hit":
      return "rec.tip.tp1";
    case "triggered":
      return "rec.tip.triggered";
    default:
      return "rec.tip.pending";
  }
}
