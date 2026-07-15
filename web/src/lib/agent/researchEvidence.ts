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

export const RESEARCH_EVIDENCE_POLICY_VERSION = "1.2.0";

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
    /\bswarm\b|بحث\s*عميق|مقارنة\s*استراتيج|portfolio\s*analysis|deep\s*research|تحليل\s*معمق/i.test(
      m,
    );
  return {
    wantsBacktest,
    wantsValidation,
    wantsSwarm,
    wantsDeep: wantsBacktest || wantsValidation || wantsSwarm,
  };
}

export { detectDeepResearchIntent };

function metricNumber(
  snapshot: TradingDnaSnapshot,
  key: TradingDnaSnapshot["metrics"][number]["key"],
): { value: number | null; confidence: number; sampleSize: number; supported: boolean } {
  const m = snapshot.metrics.find((x) => x.key === key);
  if (!m || m.status !== "supported") {
    return { value: null, confidence: 0, sampleSize: 0, supported: false };
  }
  const raw = m.value;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && Number.isFinite(Number(raw))
        ? Number(raw)
        : null;
  return {
    value,
    confidence: Math.max(0, Math.min(1, m.confidence ?? 0)),
    sampleSize: m.sampleSize ?? 0,
    supported: true,
  };
}

/**
 * Evidence-reliability DNA influence. Presence of a snapshot alone does not raise confidence.
 */
export function scoreDnaReliability(snapshot: TradingDnaSnapshot): {
  delta: number;
  detail: string;
} {
  const n = snapshot.sampleSize;
  if (n < MIN_DNA_SAMPLE) {
    return {
      delta: 0,
      detail: `insufficient_historical_metrics n=${n}`,
    };
  }
  // Sample-size reliability weight (not a presence bonus).
  const sampleWeight = n < 20 ? 0.35 : n < 50 ? 0.7 : 1;

  const strengths = snapshot.conclusions.filter((c) => c.type === "strength");
  const weaknesses = snapshot.conclusions.filter((c) => c.type === "weakness");
  const polarity =
    strengths.length > weaknesses.length
      ? 1
      : weaknesses.length > strengths.length
        ? -1
        : 0;

  const winLoss = metricNumber(snapshot, "win_loss_behavior");
  const calibration = metricNumber(snapshot, "confidence_calibration");
  const drawdown = metricNumber(snapshot, "drawdown_recovery");
  const avgR = metricNumber(snapshot, "average_r");

  const quality =
    [
      winLoss.supported ? winLoss.confidence : 0,
      calibration.supported ? calibration.confidence : 0,
      drawdown.supported ? drawdown.confidence : 0,
      avgR.supported ? avgR.confidence : 0,
    ].reduce((a, b) => a + b, 0) / 4;

  // Require some metric support — conclusions alone with zero metric support → tiny/no boost.
  const hasMetricSupport =
    winLoss.supported ||
    calibration.supported ||
    drawdown.supported ||
    avgR.supported;

  let delta = 0;
  if (polarity > 0 && hasMetricSupport) {
    delta = 0.06 * sampleWeight * Math.max(0.25, quality);
  } else if (polarity < 0) {
    delta = -0.1 * sampleWeight * Math.max(0.35, quality || 0.5);
  } else if (hasMetricSupport && avgR.value != null && avgR.value < 0) {
    delta = -0.05 * sampleWeight;
  } else {
    delta = 0;
  }

  if (drawdown.supported && drawdown.value != null && drawdown.value < 0.4) {
    delta -= 0.03 * sampleWeight;
  }
  if (calibration.supported && calibration.value != null && calibration.value < 0.45) {
    delta -= 0.02 * sampleWeight;
  }

  delta = Math.max(-0.12, Math.min(0.08, delta));
  return {
    delta,
    detail: `n=${n} polarity=${polarity} quality=${quality.toFixed(2)} strengths=${strengths.length} weaknesses=${weaknesses.length} delta=${delta.toFixed(3)}`,
  };
}

/**
 * Shadow influence scaled by shadow confidence — not a flat agree/disagree bonus.
 */
export function scoreShadowReliability(input: {
  agrees: boolean;
  shadowConfidencePct: number;
}): { delta: number; detail: string } {
  const conf = Math.max(0, Math.min(100, input.shadowConfidencePct)) / 100;
  // Low-confidence shadow barely moves the needle.
  if (conf < 0.35) {
    return {
      delta: 0,
      detail: `shadow_confidence_too_low conf=${conf.toFixed(2)}`,
    };
  }
  const delta = input.agrees ? 0.07 * conf : -0.09 * conf;
  const clamped = Math.max(-0.12, Math.min(0.08, delta));
  return {
    delta: clamped,
    detail: `agrees=${input.agrees} conf=${conf.toFixed(2)} delta=${clamped.toFixed(3)}`,
  };
}

function summarizeDna(snapshot: TradingDnaSnapshot): {
  delta: number;
  detail: string;
} {
  return scoreDnaReliability(snapshot);
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
              `سجلّ تاريخي للمشغّل (n=${sample}) أثّر على الثقة وفق موثوقية العينة.`,
            );
            summariesEn.push(
              `Operator history (n=${sample}) influenced confidence by evidence reliability.`,
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
          `سجلّ تاريخي للمشغّل (n=${dnaSnapshot.sampleSize}) أثّر على ثقة التوصية وفق موثوقية الدليل.`,
        );
        summariesEn.push(
          `Operator history (n=${dnaSnapshot.sampleSize}) influenced recommendation confidence by evidence reliability.`,
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
        const { delta, detail } = scoreShadowReliability({
          agrees,
          shadowConfidencePct: match.confidence,
        });
        recommendationConfidenceDelta += delta;
        contributions.push({
          system: "shadow_trader",
          status: delta === 0 ? "skipped" : "used",
          reason:
            delta === 0
              ? "insufficient_shadow_reliability"
              : agrees
                ? "shadow_agrees_with_recommendation"
                : "shadow_disagrees_with_recommendation",
          reasonDetail: detail,
          shadowId: match.shadowRecommendationId,
          confidenceDelta: delta,
        });
        if (delta !== 0) {
          summariesAr.push(
            agrees
              ? `مقارنة تاريخية وافقت الاتجاه — تأثير محدود حسب موثوقية العينة.`
              : `مقارنة تاريخية خالفت الاتجاه — خُفّضت الثقة وفق موثوقية العينة.`,
          );
          summariesEn.push(
            agrees
              ? `Historical comparison agreed with direction — limited reliability-weighted influence.`
              : `Historical comparison disagreed — confidence reduced by reliability weight.`,
          );
          timeline.push({ step: "shadow_trader", status: "used" });
        } else {
          timeline.push({
            step: "shadow_trader",
            status: "skipped",
            reason: "insufficient_shadow_reliability",
          });
        }
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
    // DNA may carry verified backtest IDs — influence ONLY when metrics exist.
    // Presence of job IDs alone must not raise confidence.
    const delta = 0;
    contributions.push({
      system: "backtest",
      status: "skipped",
      reason: "insufficient_historical_metrics",
      reasonDetail: `Found ${backtestIds.length} completed backtest id(s) in DNA evidence but no parsed reliability metrics in this sync path. Presence alone does not raise confidence.`,
      jobId: backtestIds[0],
      confidenceDelta: delta,
    });
    timeline.push({
      step: "backtest",
      status: "skipped",
      reason: "insufficient_historical_metrics",
    });
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
