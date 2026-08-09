/**
 * Adversarial (bull/bear) review — RELIABILITY_PLAN.md item 12.
 *
 * A single model reviewing its own thesis mostly agrees with itself. Splitting
 * the review into an advocate, a challenger, and a risk reviewer, then reporting
 * where they DISAGREE, surfaces the weak joint that one voice hides.
 *
 * Three constraints from the plan, enforced by this module's shape:
 *
 * 1. **Asynchronous deep research ONLY.** A debate round costs many model
 *    calls; it must never enter the direct request path. `assertAsyncContext`
 *    makes an accidental synchronous call fail loudly instead of silently
 *    adding tens of seconds to a live analysis.
 * 2. **Evidence, never authority.** The output is a disagreement REPORT. It
 *    carries no decision and no execution authorization, and
 *    `grantsExecutionAuthority` is hard-coded false so no caller can read one
 *    into it.
 * 3. **One failed reviewer does not void the report.** Reviews are collected
 *    defensively: a missing voice is recorded as missing, and the remainder
 *    still produce a usable report — with the gap stated.
 */

export type ReviewerRole = "advocate" | "challenger" | "risk";

export type ReviewStance = "supports" | "opposes" | "conditional" | "unavailable";

export interface ReviewerOpinion {
  role: ReviewerRole;
  stance: ReviewStance;
  /** Short, factual points. Never chain-of-thought, never internal names. */
  points: string[];
  /** Populated only when the reviewer could not run. */
  failureReason?: string;
}

export interface DisagreementReport {
  /** The thesis under review (the decision already made by the live path). */
  thesis: string;
  opinions: ReviewerOpinion[];
  /** Roles that failed to produce an opinion. */
  missingRoles: ReviewerRole[];
  /** Points the reviewers genuinely conflict on — the useful output. */
  conflicts: string[];
  /** Points more than one reviewer independently raised. */
  agreements: string[];
  /** How divided the panel is, 0 (unanimous) … 1 (fully split). */
  disagreementScore: number;
  /** ALWAYS false. A debate is evidence; it can never authorize a trade. */
  grantsExecutionAuthority: false;
  /** True when too few reviewers ran for the report to mean much. */
  insufficient: boolean;
  /** Operator-safe summary line. */
  summary: string;
}

/** Minimum reviewers whose opinions must land for a meaningful report. */
export const MIN_REVIEWERS = 2;

/**
 * Guard against the plan's hard rule: no debate in the direct request path.
 * Callers pass their execution context explicitly so a mistake is a loud
 * failure at the boundary rather than a silent latency regression in a live
 * trading answer.
 */
export function assertAsyncContext(context: "deep_research" | "direct_request"): void {
  if (context !== "deep_research") {
    throw new Error(
      "Adversarial review runs in asynchronous deep research only — never in the direct request path.",
    );
  }
}

function normalizePoint(point: string): string {
  return point.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.。،,!?]+$/u, "");
}

/**
 * Build the disagreement report from whatever opinions arrived.
 *
 * Conflicts are detected between OPPOSING stances only: two reviewers raising
 * the same concern is agreement, not conflict, even if they word it
 * differently.
 */
export function buildDisagreementReport(input: {
  thesis: string;
  opinions: readonly ReviewerOpinion[];
  context: "deep_research" | "direct_request";
}): DisagreementReport {
  assertAsyncContext(input.context);

  const usable = input.opinions.filter(
    (o) => o.stance !== "unavailable" && o.points.length > 0,
  );
  const allRoles: ReviewerRole[] = ["advocate", "challenger", "risk"];
  const presentRoles = new Set(usable.map((o) => o.role));
  const missingRoles = allRoles.filter((r) => !presentRoles.has(r));

  const supporting = usable.filter((o) => o.stance === "supports");
  const opposing = usable.filter((o) => o.stance === "opposes");

  // Agreements: a normalized point raised by more than one reviewer.
  const seen = new Map<string, { original: string; count: number }>();
  for (const opinion of usable) {
    const unique = new Set(opinion.points.map(normalizePoint));
    for (const key of unique) {
      const prior = seen.get(key);
      if (prior) prior.count += 1;
      else {
        const original = opinion.points.find((p) => normalizePoint(p) === key) ?? key;
        seen.set(key, { original, count: 1 });
      }
    }
  }
  const agreements = [...seen.values()].filter((v) => v.count > 1).map((v) => v.original);

  // Conflicts: points raised on one side of the argument and not the other.
  const conflicts: string[] = [];
  if (supporting.length > 0 && opposing.length > 0) {
    const supportKeys = new Set(supporting.flatMap((o) => o.points.map(normalizePoint)));
    for (const o of opposing) {
      for (const point of o.points) {
        if (!supportKeys.has(normalizePoint(point))) conflicts.push(point);
      }
    }
  }

  const total = usable.length;
  const disagreementScore =
    total === 0 ? 0 : Math.min(supporting.length, opposing.length) / Math.max(1, total);

  const insufficient = total < MIN_REVIEWERS;
  const summary = insufficient
    ? `مراجعة غير مكتملة: ${total} من ${allRoles.length} مراجعين فقط — لا تُبنى عليها نتيجة.`
    : conflicts.length > 0
      ? `اختلاف بين المراجعين على ${conflicts.length} نقطة${
          missingRoles.length ? ` (مع غياب ${missingRoles.length} مراجع)` : ""
        }.`
      : `المراجعون متفقون على الأطروحة${
          missingRoles.length ? ` (مع غياب ${missingRoles.length} مراجع)` : ""
        }.`;

  return {
    thesis: input.thesis,
    opinions: [...input.opinions],
    missingRoles,
    conflicts,
    agreements,
    disagreementScore,
    grantsExecutionAuthority: false,
    insufficient,
    summary,
  };
}

/**
 * Collect reviewer opinions defensively. A reviewer that throws is recorded as
 * unavailable — one failure must never void the whole report (plan, item 12).
 */
export async function collectReviewerOpinions(
  reviewers: ReadonlyArray<{ role: ReviewerRole; run: () => Promise<ReviewerOpinion> }>,
): Promise<ReviewerOpinion[]> {
  return Promise.all(
    reviewers.map(async ({ role, run }) => {
      try {
        return await run();
      } catch (error) {
        return {
          role,
          stance: "unavailable" as const,
          points: [],
          failureReason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        };
      }
    }),
  );
}
