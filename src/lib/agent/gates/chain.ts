/**
 * The gate chain runner.
 *
 * Ordered and short-circuiting: gates run G1 → G7 and the chain stops at the
 * first veto. That ordering is not cosmetic — it is cheapest-and-most-decisive
 * first. There is no reason to compute a liquidity map, match a strategy and
 * re-quote the market for a plan that a high-impact event already forbids, and
 * a blocked plan should cost one provider call, not seven.
 *
 * Every gate that DID run is reported, including the veto, so the operator
 * sees the checklist as far as it got rather than a bare refusal.
 */
import { GATE_NAMES, GATE_REQUIRED_TO_RUN } from "./types";
import type { GateChainResult, GateId, GateStatus, GateVerdict } from "./types";

export interface GateOutcome {
  status: GateStatus;
  reasonAr?: string;
  evidence?: Record<string, unknown>;
  confidenceDelta?: number;
}

export type GateFn = () => Promise<GateOutcome>;

export interface GateDefinition {
  id: GateId;
  run: GateFn;
  /**
   * Whether THIS run's `unavailable` verdict blocks, overriding the static
   * table.
   *
   * The distinction it exists for is between a provider that is DOWN and one
   * that was never deployed. "The news feed we rely on stopped answering
   * mid-analysis" is a live hazard: something changed and the plan would walk
   * into it blind. "No news feed has ever been configured on this install" is a
   * standing, admin-visible gap — treating it as a live hazard would make the
   * platform permanently silent while telling the operator a falsehood about
   * what just happened. The verdict is still reported honestly as
   * `unavailable`; only whether it blocks is narrowed.
   */
  required?: boolean;
}

/**
 * Run the chain in order, stopping at the first refusal.
 *
 * A gate that THROWS is recorded as `unavailable`, never as a pass. A thrown
 * gate is a gate whose question went unanswered, and the required/optional
 * table decides what that costs — silently treating a crash as consent is the
 * failure mode this whole module exists to make impossible.
 */
export async function runGateChain(
  gates: GateDefinition[],
  now: () => number = Date.now,
): Promise<GateChainResult> {
  const verdicts: GateVerdict[] = [];
  let confidenceDelta = 0;

  for (const gate of gates) {
    const startedAt = now();
    let outcome: GateOutcome;
    try {
      outcome = await gate.run();
    } catch (error) {
      outcome = {
        status: "unavailable",
        reasonAr: `تعذّر تشغيل فحص ${GATE_NAMES[gate.id]}: ${
          error instanceof Error ? error.message : "خطأ غير معروف"
        }`,
      };
    }

    const verdict: GateVerdict = {
      id: gate.id,
      name: GATE_NAMES[gate.id],
      status: outcome.status,
      reasonAr: outcome.reasonAr,
      evidence: outcome.evidence,
      confidenceDelta: outcome.confidenceDelta,
      startedAt,
      finishedAt: now(),
    };
    verdicts.push(verdict);
    confidenceDelta += outcome.confidenceDelta ?? 0;

    if (outcome.status === "veto") {
      return { verdicts, allowed: false, vetoedBy: verdict, confidenceDelta };
    }
    if (
      outcome.status === "unavailable" &&
      (gate.required ?? GATE_REQUIRED_TO_RUN[gate.id])
    ) {
      // Absence where absence is itself the hazard. Reported as the blocking
      // verdict so the operator is told which question went unanswered.
      return { verdicts, allowed: false, vetoedBy: verdict, confidenceDelta };
    }
  }

  return { verdicts, allowed: true, confidenceDelta };
}

/** The operator-facing checklist line for one gate. */
export function gateLineAr(v: GateVerdict): string {
  const mark = v.status === "pass" ? "✅" : v.status === "veto" ? "⛔" : "⚠️";
  const label = GATE_LABELS_AR[v.id];
  return v.reasonAr ? `${mark} ${label} — ${v.reasonAr}` : `${mark} ${label}`;
}

export const GATE_LABELS_AR: Record<GateId, string> = {
  G1: "الأخبار والأحداث الاقتصادية",
  G2: "خريطة السيولة",
  G3: "مناطق العرض والطلب",
  G4: "الهيكل والانحياز",
  G5: "مطابقة الاستراتيجية والأدلة",
  G6: "هندسة المخاطرة",
  G7: "التحقق من السعر الحي",
};

/**
 * Why no recommendation exists, in the operator's language.
 *
 * Deliberately names the gate. "No setup right now" teaches nothing; "blocked
 * for 25 minutes around CPI" tells the operator what to wait for.
 */
export function refusalSummaryAr(result: GateChainResult): string | null {
  if (result.allowed || !result.vetoedBy) return null;
  const v = result.vetoedBy;
  const label = GATE_LABELS_AR[v.id];
  if (v.status === "unavailable") {
    return `لا توجد توصية الآن: تعذّر إكمال فحص ${label}${v.reasonAr ? ` — ${v.reasonAr}` : ""}.`;
  }
  return `لا توجد توصية الآن: ${label}${v.reasonAr ? ` — ${v.reasonAr}` : ""}.`;
}
