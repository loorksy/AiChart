/**
 * Presentation helpers for the recommendation-report document.
 *
 * Kept pure (no React) so the card-layer tests can pin the two leaks the
 * modal used to ship: a relic gate's placeholder label, and the invalidation
 * price printed twice when the rule already named it.
 */
import { t } from "@/lib/i18n";
import { GATE_NAMES, type GateId } from "../gates/types";

/** Relic slots the chain keeps so ids stay stable — never a check the operator sees. */
export function isRelicGateVerdict(v: { id: string; name?: string }): boolean {
  if (v.name === "removed") return true;
  return GATE_NAMES[v.id as GateId] === "removed";
}

function relicGateLabels(): Set<string> {
  const labels = new Set<string>();
  for (const id of Object.keys(GATE_NAMES) as GateId[]) {
    if (GATE_NAMES[id] !== "removed") continue;
    labels.add(t("ar", `gate.label.${id}`));
    labels.add(t("en", `gate.label.${id}`));
  }
  return labels;
}

/**
 * Operator-facing labels that are placeholders, not checks. Applied after
 * localisation so a leaked dictionary entry cannot render even if a new
 * relic id is not yet in `GATE_NAMES`.
 */
export function isPlaceholderGateLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return true;
  return relicGateLabels().has(trimmed);
}

export function visibleGateVerdicts<T extends { id: string; name?: string }>(
  verdicts: readonly T[],
): T[] {
  return verdicts.filter((v) => !isRelicGateVerdict(v));
}

export function invalidationDisplay(
  rule?: string,
  level?: number,
): { statement: string | null; price: string | null } {
  const statement = rule?.trim() ? rule.trim() : null;
  if (level == null || !Number.isFinite(level)) {
    return { statement, price: null };
  }
  const price = level.toFixed(2);
  if (statement && statementIncludesPrice(statement, level)) {
    return { statement, price: null };
  }
  return { statement, price };
}

function statementIncludesPrice(statement: string, level: number): boolean {
  const exact = level.toFixed(2);
  const compact = exact.replace(/\.?0+$/, "");
  return statement.includes(exact) || statement.includes(String(level)) || statement.includes(compact);
}
