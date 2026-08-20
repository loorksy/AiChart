/**
 * Factor evidence — every factor a recommendation stands on must carry its
 * source, enforced at the write boundary.
 *
 * A "factor" here is an evidence dimension on the plan's revision-1 card:
 * key + grade + one operator-facing sentence. The enforceable contract:
 *
 *  - a buy/sell plan must carry at least one dimension;
 *  - every dimension needs a key, a valid grade, and a non-empty detail (the
 *    stated basis: which level, which timeframe, which reading);
 *  - the card as a whole must be grounded in at least one MEASUREMENT — an
 *    explicit `value` or a number inside a detail. Qualitative dimensions may
 *    ride alongside, but a card made only of unsourced adjectives is an
 *    opinion dressed as evidence, and the write refuses it by name.
 */

const GRADES = new Set(["strong", "moderate", "weak", "unavailable", "contradicted"]);

export class FactorEvidenceError extends Error {
  constructor(detail: string) {
    super(`Factor evidence rejected: ${detail}`);
    this.name = "FactorEvidenceError";
  }
}

interface DimensionLike {
  key?: unknown;
  grade?: unknown;
  detail?: unknown;
  value?: unknown;
}

function dimensionsOf(evidence: Record<string, unknown> | null | undefined): DimensionLike[] {
  if (!evidence) return [];
  const raw =
    (evidence.evidenceDimensions as unknown) ?? (evidence.dimensions as unknown) ?? null;
  return Array.isArray(raw) ? (raw as DimensionLike[]) : [];
}

const HAS_NUMBER = /\d/;

export function validateFactorEvidence(
  evidence: Record<string, unknown> | null | undefined,
): string[] {
  const issues: string[] = [];
  const dimensions = dimensionsOf(evidence);
  if (!dimensions.length) {
    issues.push(
      "the plan carries no evidence dimensions — every factor must exist as a graded, sourced dimension",
    );
    return issues;
  }
  let measured = 0;
  dimensions.forEach((dimension, index) => {
    const key = typeof dimension.key === "string" ? dimension.key.trim() : "";
    const grade = typeof dimension.grade === "string" ? dimension.grade : "";
    const detail = typeof dimension.detail === "string" ? dimension.detail.trim() : "";
    if (!key) issues.push(`dimension[${index}] has no key`);
    if (!GRADES.has(grade)) {
      issues.push(`dimension[${index}] (${key || "?"}) has invalid grade "${grade}"`);
    }
    if (!detail) {
      issues.push(`dimension[${index}] (${key || "?"}) has no detail — a factor must state its basis`);
    }
    const hasValue =
      typeof dimension.value === "number" ||
      (typeof dimension.value === "string" && dimension.value.trim().length > 0);
    if (hasValue || HAS_NUMBER.test(detail)) measured += 1;
  });
  if (measured === 0) {
    issues.push(
      "no dimension carries a measurement — at least one factor must be grounded in a value or a number in its detail (which level? which timeframe? which candle?)",
    );
  }
  return issues;
}

export function assertFactorEvidence(
  evidence: Record<string, unknown> | null | undefined,
): void {
  const issues = validateFactorEvidence(evidence);
  if (issues.length) throw new FactorEvidenceError(issues.join("; "));
}
