/**
 * Bounded research evidence for the canonical orchestrator.
 *
 * Never fabricates Backtest / Validation / DNA / Shadow / Swarm contribution.
 * Only claims a system contributed when it actually ran successfully and its
 * result was incorporated. Expensive research is gated by latency budget and
 * feature flags — DNA snapshot reads are cheap and preferred.
 */
import { getLatestTradingDnaSnapshot } from "@/lib/tradingDna/repository";
import type { TradingDnaSnapshot } from "@/lib/tradingDna/types";

export const RESEARCH_EVIDENCE_POLICY_VERSION = "1.0.0";

export interface ResearchEvidenceContribution {
  system:
    | "trading_dna"
    | "backtest"
    | "validation"
    | "shadow_trader"
    | "research_swarm";
  status: "used" | "skipped" | "unavailable" | "failed";
  reason: string;
  snapshotId?: string;
  confidenceDelta?: number;
}

export interface ResearchEvidenceBundle {
  policyVersion: string;
  contributions: ResearchEvidenceContribution[];
  /** Net adjustment applied to recommendation confidence (−0.15 … +0.1). */
  recommendationConfidenceDelta: number;
  summaryAr: string;
  summaryEn: string;
}

function dnaEnabled(): boolean {
  const raw = (process.env.FEATURE_TRADING_DNA_IN_ORCHESTRATOR ?? "1")
    .trim()
    .toLowerCase();
  return raw === "" || raw === "1" || raw === "true" || raw === "on";
}

function summarizeDna(
  snapshot: TradingDnaSnapshot,
): { delta: number; ar: string; en: string } {
  const strengths = snapshot.conclusions.filter((c) => c.type === "strength");
  const weaknesses = snapshot.conclusions.filter((c) => c.type === "weakness");
  let delta = 0;
  if (strengths.length > weaknesses.length) delta = 0.05;
  else if (weaknesses.length > strengths.length) delta = -0.08;
  else if (snapshot.sampleSize >= 20) delta = 0.02;
  return {
    delta,
    ar: `Trading DNA v${snapshot.version} (n=${snapshot.sampleSize}) عدّل ثقة التوصية بمقدار ${Math.round(delta * 100)} نقطة.`,
    en: `Trading DNA v${snapshot.version} (n=${snapshot.sampleSize}) adjusted recommendation confidence by ${Math.round(delta * 100)} pts.`,
  };
}

/**
 * Collect cheap, tenant-scoped research evidence. Does not start Backtest /
 * Swarm jobs — those require explicit operator request or a separate gated path.
 */
export async function collectBoundedResearchEvidence(input: {
  userId?: number;
  /** Only adjust recommendation confidence when a buy/sell candidate exists. */
  actionableCandidate: boolean;
  latencyBudgetMs?: number;
}): Promise<ResearchEvidenceBundle> {
  const contributions: ResearchEvidenceContribution[] = [];
  let recommendationConfidenceDelta = 0;
  const summariesAr: string[] = [];
  const summariesEn: string[] = [];

  if (!input.userId) {
    contributions.push({
      system: "trading_dna",
      status: "skipped",
      reason: "no_user_context",
    });
  } else if (!dnaEnabled()) {
    contributions.push({
      system: "trading_dna",
      status: "skipped",
      reason: "feature_flag_off",
    });
  } else if (!input.actionableCandidate) {
    contributions.push({
      system: "trading_dna",
      status: "skipped",
      reason: "no_actionable_candidate",
    });
  } else {
    try {
      const snapshot = await Promise.race([
        getLatestTradingDnaSnapshot(input.userId),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), input.latencyBudgetMs ?? 400),
        ),
      ]);
      if (!snapshot) {
        contributions.push({
          system: "trading_dna",
          status: "unavailable",
          reason: "no_snapshot_or_timeout",
        });
      } else {
        const { delta, ar, en } = summarizeDna(snapshot);
        recommendationConfidenceDelta += delta;
        contributions.push({
          system: "trading_dna",
          status: "used",
          reason: "latest_snapshot",
          snapshotId: snapshot.snapshotId,
          confidenceDelta: delta,
        });
        summariesAr.push(ar);
        summariesEn.push(en);
      }
    } catch {
      contributions.push({
        system: "trading_dna",
        status: "failed",
        reason: "read_error",
      });
    }
  }

  // Expensive systems are explicitly not auto-run here.
  for (const system of [
    "backtest",
    "validation",
    "shadow_trader",
    "research_swarm",
  ] as const) {
    contributions.push({
      system,
      status: "skipped",
      reason: "not_justified_for_latency_budget",
    });
  }

  recommendationConfidenceDelta = Math.max(
    -0.15,
    Math.min(0.1, recommendationConfidenceDelta),
  );

  return {
    policyVersion: RESEARCH_EVIDENCE_POLICY_VERSION,
    contributions,
    recommendationConfidenceDelta,
    summaryAr:
      summariesAr[0] ??
      "لم يُشغَّل بحث تاريخي إضافي — القرار مبني على تحليل السوق الحي فقط.",
    summaryEn:
      summariesEn[0] ??
      "No additional historical research was run — decision is live market analysis only.",
  };
}

export function researchContributed(
  bundle: ResearchEvidenceBundle,
  system: ResearchEvidenceContribution["system"],
): boolean {
  return bundle.contributions.some(
    (c) => c.system === system && c.status === "used",
  );
}
