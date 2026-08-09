/**
 * Persistent execution-mode badge mapping (RELIABILITY_PLAN.md item 11 → phase 0).
 *
 * Pure function so the mapping (envelope → label + visual tone) is unit-tested
 * without a DOM. The badge is ALWAYS shown above an assistant analysis result
 * so the basis of the answer — descriptive vs shadow/demo/live vs a fault — is
 * never ambiguous. It reads `outcome_class` first, then `execution_mode`.
 */
import type { TranslationKey } from "@/lib/i18n";
import type { ResultEnvelope } from "./resultEnvelope";

export type BadgeTone = "descriptive" | "shadow" | "demo" | "live" | "blocker";

export interface EnvelopeBadge {
  labelKey: TranslationKey;
  tone: BadgeTone;
}

/**
 * Map a result envelope to its badge. Returns null only when there is no
 * envelope at all (legacy result) — every real Phase-0 result has one.
 */
export function envelopeBadge(envelope?: ResultEnvelope | null): EnvelopeBadge | null {
  if (!envelope) return null;
  if (envelope.outcome_class === "operational_blocker") {
    return { labelKey: "agent.mode.blocker", tone: "blocker" };
  }
  if (envelope.outcome_class === "execution_validated") {
    switch (envelope.execution_mode) {
      case "live":
        return { labelKey: "agent.mode.live", tone: "live" };
      case "demo":
        return { labelKey: "agent.mode.demo", tone: "demo" };
      case "shadow":
        return { labelKey: "agent.mode.shadow", tone: "shadow" };
      // A validated outcome with a "descriptive" mode is a contradiction; fall
      // through to the safest label rather than implying execution authority.
      default:
        return { labelKey: "agent.mode.descriptive", tone: "descriptive" };
    }
  }
  // descriptive_only (and any unknown class) → descriptive, never executable.
  return { labelKey: "agent.mode.descriptive", tone: "descriptive" };
}

/** True when the envelope is a real operational fault (fault card should show). */
export function isOperationalBlocker(envelope?: ResultEnvelope | null): boolean {
  return envelope?.outcome_class === "operational_blocker";
}
