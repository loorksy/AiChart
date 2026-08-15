/**
 * Result-envelope badge mapping.
 *
 * Pure function so the mapping (envelope → label + visual tone) is unit-tested
 * without a DOM. The badge is ALWAYS shown above an assistant analysis result
 * so the basis of the answer — a real analysis vs an operational fault — is
 * never ambiguous.
 *
 * The execution-mode tones (shadow/demo/live) are gone with the execution
 * layer: a recommendations platform has exactly two things to say about an
 * answer's standing — it is an analysis, or it is a blocker.
 */
import type { TranslationKey } from "@/lib/i18n";
import type { ResultEnvelope } from "./resultEnvelope";

export type BadgeTone = "descriptive" | "blocker";

export interface EnvelopeBadge {
  labelKey: TranslationKey;
  tone: BadgeTone;
}

/**
 * Map a result envelope to its badge. Returns null only when there is no
 * envelope at all (legacy result) — every real result has one.
 */
export function envelopeBadge(envelope?: ResultEnvelope | null): EnvelopeBadge | null {
  if (!envelope) return null;
  if (envelope.outcome_class === "operational_blocker") {
    return { labelKey: "agent.mode.blocker", tone: "blocker" };
  }
  return { labelKey: "agent.mode.descriptive", tone: "descriptive" };
}

/** True when the envelope is a real operational fault (fault card should show). */
export function isOperationalBlocker(envelope?: ResultEnvelope | null): boolean {
  return envelope?.outcome_class === "operational_blocker";
}
