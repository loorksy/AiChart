/**
 * Intelligent research evidence for the canonical orchestrator.
 *
 * Never fabricates Backtest / Validation / DNA / Shadow / Swarm contribution.
 * Only claims a system contributed when it actually ran successfully and its
 * result was incorporated into this recommendation's confidence.
 *
 * Expensive Research Service jobs are never blocked-on mid-request. When a
 * blocking run is justified but cannot finish inside the latency budget, the
 * contribution is recorded as skipped with an explicit reason (never silent).
 */
import {
  researchBacktestEnabled,
  researchServiceEnabled,
  researchSwarmEnabled,
  researchSwarmPresetsEnabled,
  researchValidationEnabled,
} from "@/lib/research/client";
import { generateTradingDnaSnapshot } from "@/lib/tradingDna/service";
import {
  getLatestTradingDnaSnapshot,
  listShadowRecommendations,
} from "@/lib/tradingDna/repository";
import { collectTradingDnaEvidence } from "@/lib/tradingDna/evidence";
import type { TradingDnaSnapshot } from "@/lib/tradingDna/types";

export const RESEARCH_EVIDENCE_POLICY_VERSION = "1.1.0";

export type ResearchSystem =
  | "trading_dna"
  | "backtest"
  | "validation"
  | "shadow_trader"
  | "research_swarm";

export interface ResearchEvidenceContribution {
  system: ResearchSystem;
  status: "used" | "skipped" | "unavailable" | "failed";
  /** Machine reason code — always present, never just "Skipped". */
  reason: string;
  /** Operator-facing explanation (locale-aware at render time via reason). */
  reasonDetail: string;
  snapshotId?: string;
  jobId?: string;
  shadowId?: string;
  confidenceDelta?: number;
}

export interface EvidenceTimelineStep {
  step: string;
  status: "completed" | "used" | "skipped" | "failed";
  reason?: string;
}

export interface ResearchEvidenceBundle {
  policyVersion: string;
  contributions: ResearchEvidenceContribution[];
  /** Net adjustment applied to recommendation confidence (−0.15 … +0.1). */
  recommendationConfidenceDelta: number;
  summaryAr: string;
  summaryEn: string;
  timeline: EvidenceTimelineStep[];
  /** Transparent used/skipped lists for the UI. */
  usedSystems: ResearchSystem[];
  skippedSystems: Array<{ system: ResearchSystem; reason: string; reasonDetail: string }>;
}

export interface ResearchSelectionInput {
  userId?: number;
  requestId?: string;
  symbol?: string;
  interval?: string;
  /** buy/sell candidate exists — research may influence recommendation confidence. */
  actionableCandidate: boolean;
  decision?: "buy" | "sell" | "wait";
  /** Pre-research recommendation confidence 0–1. */
  baseConfidence?: number;
  dataQualityScore?: number;
  newsRisk?: "low" | "medium" | "high" | "unknown";
  tradingStyle?: string;
  userMessage?: string;
  latencyBudgetMs?: number;
}

const MIN_DNA_SAMPLE = 5;
const DEFAULT_BUDGET_MS = 900;

function dnaEnabled(): boolean {
  const raw = (process.env.FEATURE_TRADING_DNA_IN_ORCHESTRATOR ?? "1")
    .trim()
    .toLowerCase();
  return raw === "" || raw === "1" || raw === "true" || raw === "on";
}

function shadowEnabled(): boolean {
  const raw = (process.env.FEATURE_SHADOW_TRADER_IN_ORCHESTRATOR ?? "1")
    .trim()
    .toLowerCase();
  return raw === "" || raw === "1" || raw === "true" || raw === "on";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.then((v) => v).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function detectDeepResearchIntent(message: string | undefined): {
  wantsBacktest: boolean;
  wantsValidation: boolean;
  wantsSwarm: boolean;
  wantsDeep: boolean;
} {
  const m = (message ?? "").toLowerCase();
  const wantsBacktest =
    /\bbacktest\b|اختبار\s*تاريخ|باك\s*تست|historical\s*confirm/i.test(m);
  const wantsValidation =
    /\bvalidat|walk[\s-]?forward|monte\s*carlo|robust|تحقق\s*من\s*النتائج/i.test(
      m,
    );
  const wantsSwarm =
    /\bswarm\b|بحث\s*عميق|مقارنة\s*استراتيج|portfolio\s*analysis|deep\s*research/i.test(
      m,
    );
  return {
    wantsBacktest,
    wantsValidation,
    wantsSwarm,
    wantsDeep: wantsBacktest || wantsValidation || wantsSwarm,
  };
}

function summarizeDna(snapshot: TradingDnaSnapshot): {
  delta: number;
  detail: string;
} {
  const strengths = snapshot.conclusions.filter((c) => c.type === "strength");
  const weaknesses = snapshot.conclusions.filter((c) => c.type === "weakness");
  let delta = 0;
  if (strengths.length > weaknesses.length) delta = 0.05;
  else if (weaknesses.length > strengths.length) delta = -0.08;
  else if (snapshot.sampleSize >= 20) delta = 0.02;
  return {
    delta,
    detail: `DNA v${snapshot.version} n=${snapshot.sampleSize} strengths=${strengths.length} weaknesses=${weaknesses.length}`,
  };
}

/**
 * Decide whether historical confirmation is worth spending budget on.
 * Never returns a silent skip — always a concrete reason code.
 */
export function decideResearchJustification(input: ResearchSelectionInput): {
  dnaWorth: boolean;
  shadowWorth: boolean;
  backtestWorth: boolean;
  validationWorth: boolean;
  swarmWorth: boolean;
  reasons: Record<string, string>;
} {
  const intent = detectDeepResearchIntent(input.userMessage);
  const conf = input.baseConfidence ?? 0.5;
  const dataQ = input.dataQualityScore ?? 0.5;
  const style = (input.tradingStyle ?? "day").toLowerCase();
  const midUncertainty = conf >= 0.45 && conf <= 0.78;
  const alreadyHigh = conf >= 0.85 && dataQ >= 0.8;
  const historicalStyle = style === "swing" || style === "position";

  const reasons: Record<string, string> = {};

  if (!input.actionableCandidate) {
    reasons.dna = "no_actionable_candidate";
    reasons.shadow = "no_actionable_candidate";
    reasons.backtest = "no_actionable_candidate";
    reasons.validation = "no_actionable_candidate";
    reasons.swarm = "simple_or_non_actionable_analysis";
    return {
      dnaWorth: false,
      shadowWorth: false,
      backtestWorth: false,
      validationWorth: false,
      swarmWorth: false,
      reasons,
    };
  }

  // DNA / Shadow: cheap, always worth attempting for actionable setups.
  reasons.dna = "actionable_setup_benefits_from_operator_history";
  reasons.shadow = "actionable_setup_benefits_from_shadow_comparison";

  let backtestWorth = false;
  if (alreadyHigh && !intent.wantsBacktest) {
    reasons.backtest = "confidence_already_sufficient";
  } else if (intent.wantsBacktest || (midUncertainty && historicalStyle)) {
    backtestWorth = true;
    reasons.backtest = intent.wantsBacktest
      ? "user_requested_historical_confirmation"
      : "mid_confidence_with_swing_style_needs_history";
  } else if (midUncertainty) {
    backtestWorth = true;
    reasons.backtest = "mid_confidence_uncertainty";
  } else {
    reasons.backtest = "not_justified_for_this_request";
  }

  let validationWorth = false;
  if (!backtestWorth && !intent.wantsValidation) {
    reasons.validation = "no_backtest_justified";
  } else if (intent.wantsValidation || backtestWorth) {
    validationWorth = true;
    reasons.validation = intent.wantsValidation
      ? "user_requested_validation"
      : "validation_follows_justified_backtest";
  } else {
    reasons.validation = "not_justified_for_this_request";
  }

  let swarmWorth = false;
  if (!intent.wantsSwarm && !intent.wantsDeep) {
    reasons.swarm = "simple_chart_analysis";
  } else {
    swarmWorth = true;
    reasons.swarm = "deep_investigation_intent";
  }

  return {
    dnaWorth: true,
    shadowWorth: true,
    backtestWorth,
    validationWorth,
    swarmWorth,
    reasons,
  };
}

/**
 * Collect tenant-scoped research evidence with intelligent selection.
 */
export async function collectBoundedResearchEvidence(
  input: ResearchSelectionInput,
): Promise<ResearchEvidenceBundle> {
  const budget = Math.max(200, input.latencyBudgetMs ?? DEFAULT_BUDGET_MS);
  const started = Date.now();
  const remaining = () => Math.max(50, budget - (Date.now() - started));

  const contributions: ResearchEvidenceContribution[] = [];
  let recommendationConfidenceDelta = 0;
  const summariesAr: string[] = [];
  const summariesEn: string[] = [];
  const timeline: EvidenceTimelineStep[] = [
    { step: "market_synchronized", status: "completed" },
    { step: "chart_analyzed", status: "completed" },
    { step: "risk_checks", status: "completed" },
  ];

  const plan = decideResearchJustification(input);
  let dnaSnapshot: TradingDnaSnapshot | null = null;

  // ---- Trading DNA ----
  if (!input.userId) {
    contributions.push({
      system: "trading_dna",
      status: "skipped",
      reason: "no_user_context",
      reasonDetail: "No authenticated user context for tenant-isolated DNA.",
    });
    timeline.push({
      step: "trading_dna",
      status: "skipped",
      reason: "no_user_context",
    });
  } else if (!dnaEnabled()) {
    contributions.push({
      system: "trading_dna",
      status: "skipped",
      reason: "feature_flag_off",
      reasonDetail: "FEATURE_TRADING_DNA_IN_ORCHESTRATOR is disabled.",
    });
    timeline.push({
      step: "trading_dna",
      status: "skipped",
      reason: "feature_flag_off",
    });
  } else if (!plan.dnaWorth) {
    contributions.push({
      system: "trading_dna",
      status: "skipped",
      reason: plan.reasons.dna,
      reasonDetail: "DNA is reserved for actionable buy/sell candidates.",
    });
    timeline.push({
      step: "trading_dna",
      status: "skipped",
      reason: plan.reasons.dna,
    });
  } else {
    try {
      dnaSnapshot = await withTimeout(
        getLatestTradingDnaSnapshot(input.userId),
        Math.min(350, remaining()),
      );
      if (!dnaSnapshot) {
        // Auto-generate when enough historical evidence already exists.
        const evidence = await withTimeout(
          collectTradingDnaEvidence(input.userId),
          Math.min(400, remaining()),
        );
        const sample = evidence?.recommendations.length ?? 0;
        if (sample >= MIN_DNA_SAMPLE) {
          const generated = await withTimeout(
            generateTradingDnaSnapshot(input.userId),
            Math.min(500, remaining()),
          );
          dnaSnapshot = generated?.snapshot ?? null;
          if (dnaSnapshot) {
            const { delta, detail } = summarizeDna(dnaSnapshot);
            recommendationConfidenceDelta += delta;
            contributions.push({
              system: "trading_dna",
              status: "used",
              reason: "auto_generated_from_sufficient_evidence",
              reasonDetail: `Generated DNA from ${sample} recommendations. ${detail}`,
              snapshotId: dnaSnapshot.snapshotId,
              confidenceDelta: delta,
            });
            summariesAr.push(
              `Trading DNA (مولَّد تلقائياً، n=${sample}) عدّل الثقة بمقدار ${Math.round(delta * 100)} نقطة.`,
            );
            summariesEn.push(
              `Trading DNA (auto-generated, n=${sample}) adjusted confidence by ${Math.round(delta * 100)} pts.`,
            );
            timeline.push({ step: "trading_dna", status: "used" });
          } else {
            contributions.push({
              system: "trading_dna",
              status: "unavailable",
              reason: "generation_timeout_or_failed",
              reasonDetail:
                "Evidence existed but DNA generation exceeded the latency budget.",
            });
            timeline.push({
              step: "trading_dna",
              status: "skipped",
              reason: "generation_timeout_or_failed",
            });
          }
        } else {
          contributions.push({
            system: "trading_dna",
            status: "skipped",
            reason: "insufficient_evidence",
            reasonDetail: `Only ${sample} historical recommendations (need ≥${MIN_DNA_SAMPLE}) to build DNA.`,
          });
          timeline.push({
            step: "trading_dna",
            status: "skipped",
            reason: "insufficient_evidence",
          });
        }
      } else {
        const { delta, detail } = summarizeDna(dnaSnapshot);
        recommendationConfidenceDelta += delta;
        contributions.push({
          system: "trading_dna",
          status: "used",
          reason: "latest_snapshot",
          reasonDetail: detail,
          snapshotId: dnaSnapshot.snapshotId,
          confidenceDelta: delta,
        });
        summariesAr.push(
          `Trading DNA v${dnaSnapshot.version} (n=${dnaSnapshot.sampleSize}) عدّل ثقة التوصية بمقدار ${Math.round(delta * 100)} نقطة.`,
        );
        summariesEn.push(
          `Trading DNA v${dnaSnapshot.version} (n=${dnaSnapshot.sampleSize}) adjusted recommendation confidence by ${Math.round(delta * 100)} pts.`,
        );
        timeline.push({ step: "trading_dna", status: "used" });
      }
    } catch {
      contributions.push({
        system: "trading_dna",
        status: "failed",
        reason: "read_error",
        reasonDetail: "DNA repository read/generate threw an error.",
      });
      timeline.push({ step: "trading_dna", status: "failed", reason: "read_error" });
    }
  }

  // ---- Shadow Trader (confidence only; never executes) ----
  if (!input.userId) {
    contributions.push({
      system: "shadow_trader",
      status: "skipped",
      reason: "no_user_context",
      reasonDetail: "No authenticated user for Shadow Trader.",
    });
    timeline.push({
      step: "shadow_trader",
      status: "skipped",
      reason: "no_user_context",
    });
  } else if (!shadowEnabled()) {
    contributions.push({
      system: "shadow_trader",
      status: "skipped",
      reason: "feature_flag_off",
      reasonDetail: "FEATURE_SHADOW_TRADER_IN_ORCHESTRATOR is disabled.",
    });
    timeline.push({
      step: "shadow_trader",
      status: "skipped",
      reason: "feature_flag_off",
    });
  } else if (!plan.shadowWorth) {
    contributions.push({
      system: "shadow_trader",
      status: "skipped",
      reason: plan.reasons.shadow,
      reasonDetail: "Shadow comparison requires an actionable candidate.",
    });
    timeline.push({
      step: "shadow_trader",
      status: "skipped",
      reason: plan.reasons.shadow,
    });
  } else {
    try {
      const symbol = (input.symbol ?? "").toUpperCase();
      const shadows = await withTimeout(
        listShadowRecommendations(input.userId, 40),
        Math.min(300, remaining()),
      );
      const match = (shadows ?? []).find(
        (s) =>
          s.symbol.toUpperCase() === symbol &&
          (s.direction === "buy" || s.direction === "sell"),
      );
      if (!match) {
        contributions.push({
          system: "shadow_trader",
          status: "skipped",
          reason: "no_shadow_history_for_symbol",
          reasonDetail: `No prior shadow recommendations for ${symbol || "symbol"}.`,
        });
        timeline.push({
          step: "shadow_trader",
          status: "skipped",
          reason: "no_shadow_history_for_symbol",
        });
      } else if (
        input.decision &&
        (input.decision === "buy" || input.decision === "sell")
      ) {
        const agrees = match.direction === input.decision;
        const delta = agrees ? 0.04 : -0.06;
        recommendationConfidenceDelta += delta;
        contributions.push({
          system: "shadow_trader",
          status: "used",
          reason: agrees
            ? "shadow_agrees_with_recommendation"
            : "shadow_disagrees_with_recommendation",
          reasonDetail: `Shadow ${match.shadowRecommendationId} directed ${match.direction} @ ${match.confidence}% vs agent ${input.decision}.`,
          shadowId: match.shadowRecommendationId,
          confidenceDelta: delta,
        });
        summariesAr.push(
          agrees
            ? `Shadow Trader وافق الاتجاه (${match.direction}) — تعزيز طفيف للثقة.`
            : `Shadow Trader خالف الاتجاه (ظلّ: ${match.direction}) — خُفّضت الثقة.`,
        );
        summariesEn.push(
          agrees
            ? `Shadow Trader agreed (${match.direction}) — slight confidence boost.`
            : `Shadow Trader disagreed (shadow: ${match.direction}) — confidence reduced.`,
        );
        timeline.push({ step: "shadow_trader", status: "used" });
      } else {
        contributions.push({
          system: "shadow_trader",
          status: "skipped",
          reason: "no_directional_decision_to_compare",
          reasonDetail: "WAIT/informational decisions do not consume Shadow influence.",
        });
        timeline.push({
          step: "shadow_trader",
          status: "skipped",
          reason: "no_directional_decision_to_compare",
        });
      }
    } catch {
      contributions.push({
        system: "shadow_trader",
        status: "failed",
        reason: "read_error",
        reasonDetail: "Failed to read shadow recommendations.",
      });
      timeline.push({
        step: "shadow_trader",
        status: "failed",
        reason: "read_error",
      });
    }
  }

  // ---- Backtest (use completed artifacts from DNA only; never block on new run) ----
  const backtestIds = dnaSnapshot?.evidence.backtestIds ?? [];
  if (!researchServiceEnabled() || !researchBacktestEnabled()) {
    contributions.push({
      system: "backtest",
      status: "skipped",
      reason: "feature_flag_off",
      reasonDetail: humanizeSkip("feature_flag_off"),
    });
    timeline.push({
      step: "backtest",
      status: "skipped",
      reason: "feature_flag_off",
    });
  } else if (!plan.backtestWorth) {
    contributions.push({
      system: "backtest",
      status: "skipped",
      reason: plan.reasons.backtest,
      reasonDetail: humanizeSkip(plan.reasons.backtest),
    });
    timeline.push({
      step: "backtest",
      status: "skipped",
      reason: plan.reasons.backtest,
    });
  } else if (backtestIds.length === 0) {
    contributions.push({
      system: "backtest",
      status: "skipped",
      reason: "justified_but_no_completed_job_in_latency_budget",
      reasonDetail:
        "Historical confirmation is justified, but no completed tenant-verified backtest is attached to DNA yet. A blocking Research Service run is not started mid-request (latency/safety). Queue a backtest from Research when needed.",
    });
    timeline.push({
      step: "backtest",
      status: "skipped",
      reason: "justified_but_no_completed_job_in_latency_budget",
    });
  } else {
    // DNA already carries verified backtest references — influence lightly.
    const delta = 0.03;
    recommendationConfidenceDelta += delta;
    contributions.push({
      system: "backtest",
      status: "used",
      reason: "completed_jobs_referenced_in_dna",
      reasonDetail: `Used ${backtestIds.length} completed backtest id(s) already verified in Trading DNA evidence.`,
      jobId: backtestIds[0],
      confidenceDelta: delta,
    });
    summariesEn.push(
      `Backtest evidence (${backtestIds.length} completed job(s) in DNA) supported the setup.`,
    );
    summariesAr.push(
      `أدلة Backtest (${backtestIds.length} مهمة مكتملة في DNA) دعمت الإعداد.`,
    );
    timeline.push({ step: "backtest", status: "used" });
  }

  // ---- Validation (never raises confidence alone; only after backtest used) ----
  const backtestUsed = contributions.some(
    (c) => c.system === "backtest" && c.status === "used",
  );
  if (!researchValidationEnabled()) {
    contributions.push({
      system: "validation",
      status: "skipped",
      reason: "feature_flag_off",
      reasonDetail: humanizeSkip("feature_flag_off"),
    });
    timeline.push({
      step: "validation",
      status: "skipped",
      reason: "feature_flag_off",
    });
  } else if (!plan.validationWorth) {
    contributions.push({
      system: "validation",
      status: "skipped",
      reason: plan.reasons.validation,
      reasonDetail: humanizeSkip(plan.reasons.validation),
    });
    timeline.push({
      step: "validation",
      status: "skipped",
      reason: plan.reasons.validation,
    });
  } else if (!backtestUsed) {
    contributions.push({
      system: "validation",
      status: "skipped",
      reason: "no_backtest_executed",
      reasonDetail:
        "Validation verifies completed Backtests. No Backtest was incorporated in this run.",
    });
    timeline.push({
      step: "validation",
      status: "skipped",
      reason: "no_backtest_executed",
    });
  } else {
    // Honest: DNA may reference backtest job IDs, but Validation is a separate
    // job type. We do not inflate confidence from Validation here.
    contributions.push({
      system: "validation",
      status: "skipped",
      reason: "no_dedicated_validation_run_in_this_request",
      reasonDetail:
        "A Backtest reference existed, but no walk-forward/Monte Carlo/sensitivity Validation job was executed or verified in this request path. Validation never increases confidence by itself.",
      confidenceDelta: 0,
    });
    timeline.push({
      step: "validation",
      status: "skipped",
      reason: "no_dedicated_validation_run_in_this_request",
    });
  }

  // ---- Research Swarm ----
  if (!researchSwarmEnabled() || !researchSwarmPresetsEnabled()) {
    contributions.push({
      system: "research_swarm",
      status: "skipped",
      reason: "feature_flag_off",
      reasonDetail: humanizeSkip("feature_flag_off"),
    });
    timeline.push({
      step: "research_swarm",
      status: "skipped",
      reason: "feature_flag_off",
    });
  } else if (!plan.swarmWorth) {
    contributions.push({
      system: "research_swarm",
      status: "skipped",
      reason: plan.reasons.swarm,
      reasonDetail: humanizeSkip(plan.reasons.swarm),
    });
    timeline.push({
      step: "research_swarm",
      status: "skipped",
      reason: plan.reasons.swarm,
    });
  } else {
    contributions.push({
      system: "research_swarm",
      status: "skipped",
      reason: "justified_but_blocking_swarm_not_allowed_in_request_path",
      reasonDetail:
        "Deep investigation is justified, but Swarm runs are asynchronous and must not block the trading decision path. Start a Swarm from Research when needed; results can inform a later recommendation once completed.",
    });
    timeline.push({
      step: "research_swarm",
      status: "skipped",
      reason: "justified_but_blocking_swarm_not_allowed_in_request_path",
    });
  }

  recommendationConfidenceDelta = Math.max(
    -0.15,
    Math.min(0.1, recommendationConfidenceDelta),
  );

  const usedSystems = contributions
    .filter((c) => c.status === "used")
    .map((c) => c.system);
  const skippedSystems = contributions
    .filter((c) => c.status !== "used")
    .map((c) => ({
      system: c.system,
      reason: c.reason,
      reasonDetail: c.reasonDetail,
    }));

  timeline.push({
    step: "final_recommendation",
    status: "completed",
    reason: input.decision ?? (input.actionableCandidate ? "pending" : "wait"),
  });

  return {
    policyVersion: RESEARCH_EVIDENCE_POLICY_VERSION,
    contributions,
    recommendationConfidenceDelta,
    summaryAr:
      summariesAr.length > 0
        ? summariesAr.join(" ")
        : "لم يُدمج بحث تاريخي إضافي في هذه التوصية — القرار مبني على تحليل السوق الحي مع أسباب تخطّي صريحة.",
    summaryEn:
      summariesEn.length > 0
        ? summariesEn.join(" ")
        : "No additional historical research was incorporated — decision is live market analysis with explicit skip reasons.",
    timeline,
    usedSystems,
    skippedSystems,
  };
}

function humanizeSkip(code: string): string {
  const map: Record<string, string> = {
    no_actionable_candidate: "No actionable buy/sell candidate in this run.",
    feature_flag_off: "Feature flag disables this research component.",
    confidence_already_sufficient:
      "Live analysis confidence is already high; extra research is not justified.",
    not_justified_for_this_request:
      "Signals (confidence, style, intent) do not justify this research cost.",
    no_backtest_justified: "Validation requires a justified Backtest first.",
    simple_chart_analysis:
      "Simple chart analysis — Research Swarm is reserved for deep investigations.",
    simple_or_non_actionable_analysis:
      "Non-actionable or simple analysis — expensive research skipped.",
    user_requested_historical_confirmation:
      "Operator requested historical confirmation.",
    mid_confidence_with_swing_style_needs_history:
      "Swing/position mode with mid confidence benefits from history.",
    mid_confidence_uncertainty: "Mid-range confidence — historical confirmation is valuable.",
    deep_investigation_intent: "Operator requested deep/swarm-style investigation.",
  };
  return map[code] ?? code;
}

export function researchContributed(
  bundle: ResearchEvidenceBundle,
  system: ResearchSystem,
): boolean {
  return bundle.contributions.some(
    (c) => c.system === system && c.status === "used",
  );
}

/** Build operator-facing used/skipped lines for the recommendation card. */
export function formatResearchTransparency(
  bundle: ResearchEvidenceBundle,
  locale: "ar" | "en",
): string[] {
  const lines: string[] = [];
  if (locale === "ar") {
    lines.push("الأدلة المستخدمة:");
    for (const s of bundle.usedSystems) lines.push(`✓ ${labelAr(s)}`);
    if (bundle.usedSystems.length === 0) lines.push("— لا يوجد بحث تاريخي مدمج");
    lines.push("تم التخطي:");
    for (const s of bundle.skippedSystems) {
      lines.push(`• ${labelAr(s.system)} — ${s.reasonDetail}`);
    }
  } else {
    lines.push("Evidence used:");
    for (const s of bundle.usedSystems) lines.push(`✓ ${labelEn(s)}`);
    if (bundle.usedSystems.length === 0) lines.push("— no historical research incorporated");
    lines.push("Skipped:");
    for (const s of bundle.skippedSystems) {
      lines.push(`• ${labelEn(s.system)} — ${s.reasonDetail}`);
    }
  }
  return lines;
}

function labelAr(s: ResearchSystem): string {
  switch (s) {
    case "trading_dna":
      return "Trading DNA";
    case "backtest":
      return "Backtest";
    case "validation":
      return "Validation";
    case "shadow_trader":
      return "Shadow Trader";
    case "research_swarm":
      return "Research Swarm";
  }
}

function labelEn(s: ResearchSystem): string {
  return labelAr(s);
}
