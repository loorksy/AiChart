/**
 * Result-envelope standing checks.
 *
 * The per-message badge mapping that used to live here is gone with the badge
 * itself: the "descriptive — not authorized" pill was stamped above every
 * assistant reply (greetings included), and it now lives ONCE as small print
 * under the composer. What remains is the one distinction the chat still
 * renders per message: an operational fault shows its fault card.
 */
import type { ResultEnvelope } from "./resultEnvelope";

/** True when the envelope is a real operational fault (fault card should show). */
export function isOperationalBlocker(envelope?: ResultEnvelope | null): boolean {
  return envelope?.outcome_class === "operational_blocker";
}
