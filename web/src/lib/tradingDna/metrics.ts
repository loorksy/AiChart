import {
  evidenceFromBundle,
  mergeEvidence,
  normalizeEvidence,
} from "./evidence";
import type {
  EvidenceReferences,
  TradingDnaEvidenceBundle,
  TradingDnaMetric,
  TradingDnaMetricKey,
  TradingDnaOutcomeEvidence,
  TradingDnaRecommendationEvidence,
} from "./types";

function round(value: number, precision = 4): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue))]!;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function confidence(sampleSize: number, minimum: number): number {
  return round(sampleSize / (sampleSize + Math.max(1, minimum)), 4);
}

function evidenceForRecommendations(
  recommendations: TradingDnaRecommendationEvidence[],
  bundle: TradingDnaEvidenceBundle,
): EvidenceReferences {
  const ids = new Set(recommendations.map((item) => item.recommendationId));
  return normalizeEvidence({
    recommendationIds: [...ids],
    tradeIds: bundle.trades
      .filter((item) => item.recommendationId != null && ids.has(item.recommendationId))
      .map((item) => item.tradeId),
    learningEventIds: bundle.learningEvents
      .filter((item) => ids.has(item.recommendationId))
      .map((item) => item.eventId),
  });
}

function evidenceForOutcomes(
  outcomes: TradingDnaOutcomeEvidence[],
  bundle: TradingDnaEvidenceBundle,
): EvidenceReferences {
  const ids = new Set(outcomes.map((item) => item.recommendationId));
  return evidenceForRecommendations(
    bundle.recommendations.filter((item) => ids.has(item.recommendationId)),
    bundle,
  );
}

function supported(
  key: TradingDnaMetricKey,
  value: TradingDnaMetric["value"],
  sampleSize: number,
  minimum: number,
  methodology: string,
  evidence: EvidenceReferences,
  unit?: string,
): TradingDnaMetric {
  return {
    key,
    status: "supported",
    value,
    unit,
    sampleSize,
    confidence: confidence(sampleSize, minimum),
    methodology,
    evidence,
  };
}

function insufficient(
  key: TradingDnaMetricKey,
  sampleSize: number,
  minimum: number,
  methodology: string,
  evidence: EvidenceReferences,
): TradingDnaMetric {
  return {
    key,
    status: "insufficient_evidence",
    sampleSize,
    confidence: confidence(sampleSize, minimum),
    methodology: `${methodology}; requires at least ${minimum} recorded observations`,
    evidence,
  };
}

function numericOutcomeMetric(
  bundle: TradingDnaEvidenceBundle,
  key: TradingDnaMetricKey,
  select: (outcome: TradingDnaOutcomeEvidence) => number | undefined,
  minimum: number,
  methodology: string,
  unit: string,
): TradingDnaMetric {
  const rows = bundle.outcomes.flatMap((outcome) => {
    const value = select(outcome);
    return value == null || !Number.isFinite(value) ? [] : [{ outcome, value }];
  });
  const evidence = evidenceForOutcomes(rows.map((row) => row.outcome), bundle);
  if (rows.length < minimum) return insufficient(key, rows.length, minimum, methodology, evidence);
  const values = rows.map((row) => row.value);
  return supported(
    key,
    {
      average: round(mean(values)),
      median: round(median(values)),
      p90: round(percentile(values, 0.9)),
      minimum: round(Math.min(...values)),
      maximum: round(Math.max(...values)),
    },
    rows.length,
    minimum,
    methodology,
    evidence,
    unit,
  );
}

function countGroups(values: string[]): Array<Record<string, unknown>> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value || "unknown", (counts.get(value || "unknown") ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, share: round(count / values.length) }))
    .sort((a, b) => Number(b.count) - Number(a.count) || String(a.key).localeCompare(String(b.key)));
}

function preferenceMetric(
  bundle: TradingDnaEvidenceBundle,
  key: "preferred_symbols" | "preferred_timeframes" | "preferred_strategies",
  select: (recommendation: TradingDnaRecommendationEvidence) => string,
): TradingDnaMetric {
  const rows = bundle.recommendations.filter((item) => select(item).length > 0);
  const evidence = evidenceForRecommendations(rows, bundle);
  if (!rows.length) return insufficient(key, 0, 1, "Frequency of canonical recommendations", evidence);
  return supported(
    key,
    countGroups(rows.map(select)),
    rows.length,
    5,
    "Frequency and share of canonical recommendations",
    evidence,
  );
}

function session(createdAt: number): string {
  const hour = new Date(createdAt).getUTCHours();
  if (hour < 8) return "asia";
  if (hour < 13) return "london";
  if (hour < 21) return "new_york";
  return "off_hours";
}

function winLossMetric(bundle: TradingDnaEvidenceBundle): TradingDnaMetric {
  const result = new Map<number, "win" | "loss">();
  for (const event of bundle.learningEvents) {
    if (event.eventType === "RecommendationSucceeded") result.set(event.recommendationId, "win");
    if (event.eventType === "RecommendationFailed") result.set(event.recommendationId, "loss");
  }
  const recommendations = bundle.recommendations.filter((item) => result.has(item.recommendationId));
  const wins = recommendations.filter((item) => result.get(item.recommendationId) === "win").length;
  const losses = recommendations.length - wins;
  const evidence = evidenceForRecommendations(recommendations, bundle);
  if (recommendations.length < 3) {
    return insufficient(
      "win_loss_behavior",
      recommendations.length,
      3,
      "Canonical success/failure learning events per completed recommendation",
      evidence,
    );
  }
  return supported(
    "win_loss_behavior",
    {
      wins,
      losses,
      winRate: round(wins / recommendations.length),
      lossRate: round(losses / recommendations.length),
    },
    recommendations.length,
    10,
    "Canonical success/failure learning events per completed recommendation",
    evidence,
    "ratio",
  );
}

function outcomeBehaviorMetric(
  bundle: TradingDnaEvidenceBundle,
  key: "break_even_behavior" | "trailing_behavior",
  outcomeType: "BreakEven" | "Trailing",
): TradingDnaMetric {
  const completedIds = new Set(
    bundle.learningEvents
      .filter((item) => ["RecommendationSucceeded", "RecommendationFailed"].includes(item.eventType))
      .map((item) => item.recommendationId),
  );
  const matches = bundle.outcomes.filter((item) => item.type === outcomeType);
  const relevant = bundle.recommendations.filter((item) => completedIds.has(item.recommendationId));
  const evidence = mergeEvidence(
    evidenceForRecommendations(relevant, bundle),
    evidenceForOutcomes(matches, bundle),
  );
  if (relevant.length < 3) {
    return insufficient(key, relevant.length, 3, `${outcomeType} outcomes among completed recommendations`, evidence);
  }
  return supported(
    key,
    { count: matches.length, rate: round(matches.length / relevant.length) },
    relevant.length,
    10,
    `${outcomeType} outcomes among completed recommendations`,
    evidence,
    "ratio",
  );
}

function riskScalingMetric(bundle: TradingDnaEvidenceBundle): TradingDnaMetric {
  const rows = bundle.outcomes.filter((item) => item.riskUsed != null && Number.isFinite(item.riskUsed));
  const evidence = evidenceForOutcomes(rows, bundle);
  if (rows.length < 5) {
    return insufficient("risk_scaling", rows.length, 5, "Recorded risk-used change over chronological outcomes", evidence);
  }
  const middle = Math.floor(rows.length / 2);
  const first = mean(rows.slice(0, middle).map((item) => item.riskUsed!));
  const second = mean(rows.slice(middle).map((item) => item.riskUsed!));
  return supported(
    "risk_scaling",
    {
      firstHalfAverage: round(first),
      secondHalfAverage: round(second),
      changeRatio: first === 0 ? null : round((second - first) / Math.abs(first)),
    },
    rows.length,
    10,
    "Recorded risk-used averages in the first and second chronological halves",
    evidence,
    "recorded risk units",
  );
}

function drawdownMetric(bundle: TradingDnaEvidenceBundle): TradingDnaMetric {
  const rows = bundle.outcomes.flatMap((item) => {
    const value = item.rMultiple ?? item.pnl;
    return value == null || !Number.isFinite(value) ? [] : [{ item, value }];
  });
  const evidence = evidenceForOutcomes(rows.map((row) => row.item), bundle);
  if (rows.length < 5) {
    return insufficient("drawdown_recovery", rows.length, 5, "Cumulative recorded R or PnL outcome path", evidence);
  }
  let equity = 0;
  let peak = 0;
  let maximumDrawdown = 0;
  let recoveryTarget = 0;
  let worstIndex = 0;
  for (const [index, row] of rows.entries()) {
    equity += row.value;
    if (equity > peak) {
      peak = equity;
    }
    const drawdown = peak - equity;
    if (drawdown > maximumDrawdown) {
      maximumDrawdown = drawdown;
      worstIndex = index;
      recoveryTarget = peak;
    }
  }
  let replay = rows.slice(0, worstIndex + 1).reduce((sum, row) => sum + row.value, 0);
  let recoveredAt: number | undefined;
  for (let index = worstIndex + 1; index < rows.length; index += 1) {
    replay += rows[index]!.value;
    if (replay >= recoveryTarget) {
      recoveredAt = index;
      break;
    }
  }
  return supported(
    "drawdown_recovery",
    {
      maximumDrawdown: round(maximumDrawdown),
      recovered: recoveredAt != null,
      recoveryObservations: recoveredAt == null ? null : recoveredAt - worstIndex,
    },
    rows.length,
    10,
    "Maximum peak-to-trough drawdown and observed recovery on the chronological outcome path",
    evidence,
    rows.every((row) => row.item.rMultiple != null) ? "R" : "mixed recorded units",
  );
}

function calibrationMetric(bundle: TradingDnaEvidenceBundle): TradingDnaMetric {
  const result = new Map<number, number>();
  for (const event of bundle.learningEvents) {
    if (event.eventType === "RecommendationSucceeded") result.set(event.recommendationId, 1);
    if (event.eventType === "RecommendationFailed") result.set(event.recommendationId, 0);
  }
  const rows = bundle.recommendations.filter((item) => result.has(item.recommendationId));
  const evidence = evidenceForRecommendations(rows, bundle);
  if (rows.length < 5) {
    return insufficient("confidence_calibration", rows.length, 5, "Mean absolute probability error against completed outcomes", evidence);
  }
  const predicted = mean(rows.map((item) => Math.max(0, Math.min(1, item.confidence / 100))));
  const observed = mean(rows.map((item) => result.get(item.recommendationId)!));
  const error = mean(
    rows.map((item) => Math.abs(Math.max(0, Math.min(1, item.confidence / 100)) - result.get(item.recommendationId)!)),
  );
  return supported(
    "confidence_calibration",
    {
      predictedSuccessRate: round(predicted),
      observedSuccessRate: round(observed),
      meanAbsoluteError: round(error),
      bias: round(predicted - observed),
    },
    rows.length,
    20,
    "Mean absolute probability error and aggregate bias against canonical success/failure events",
    evidence,
    "ratio",
  );
}

function executionConsistencyMetric(bundle: TradingDnaEvidenceBundle): TradingDnaMetric {
  const rows = bundle.outcomes.flatMap((item) => {
    const fields = [item.spreadCost, item.slippage, item.commission].filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
    return fields.length ? [{ item, totalCost: fields.reduce((sum, value) => sum + Math.abs(value), 0) }] : [];
  });
  const evidence = evidenceForOutcomes(rows.map((row) => row.item), bundle);
  if (rows.length < 3) {
    return insufficient("execution_consistency", rows.length, 3, "Variation in recorded spread, slippage and commission", evidence);
  }
  const costs = rows.map((row) => row.totalCost);
  const average = mean(costs);
  return supported(
    "execution_consistency",
    {
      averageRecordedCost: round(average),
      standardDeviation: round(stdDev(costs)),
      coefficientOfVariation: average === 0 ? 0 : round(stdDev(costs) / average),
    },
    rows.length,
    10,
    "Variation in absolute recorded spread, slippage and commission totals",
    evidence,
    "recorded cost units",
  );
}

function portfolioConcentrationMetric(bundle: TradingDnaEvidenceBundle): TradingDnaMetric {
  const rows = bundle.recommendations;
  const evidence = evidenceForRecommendations(rows, bundle);
  if (rows.length < 3) {
    return insufficient("portfolio_concentration", rows.length, 3, "Recommendation concentration by symbol", evidence);
  }
  const counts = countGroups(rows.map((item) => item.symbol));
  const shares = counts.map((item) => Number(item.share));
  return supported(
    "portfolio_concentration",
    {
      dominantSymbol: counts[0]?.key ?? "unknown",
      dominantShare: counts[0]?.share ?? 0,
      herfindahlIndex: round(shares.reduce((sum, value) => sum + value ** 2, 0)),
    },
    rows.length,
    10,
    "Symbol share and Herfindahl concentration across canonical recommendations",
    evidence,
    "ratio",
  );
}

export function computeTradingDnaMetrics(bundle: TradingDnaEvidenceBundle): TradingDnaMetric[] {
  const sessionRows = bundle.recommendations.filter((item) => item.createdAt > 0);
  const sessionEvidence = evidenceForRecommendations(sessionRows, bundle);
  const sessionMetric = sessionRows.length
    ? supported(
        "preferred_sessions",
        countGroups(sessionRows.map((item) => session(item.createdAt))),
        sessionRows.length,
        5,
        "UTC session bucket frequency of canonical recommendation creation",
        sessionEvidence,
      )
    : insufficient("preferred_sessions", 0, 1, "UTC session bucket frequency", sessionEvidence);
  const backtestEvidence = normalizeEvidence({
    backtestIds: bundle.backtests.map((item) => item.jobId),
    artifactIds: bundle.backtests.flatMap((item) => item.artifactIds),
  });
  const backtestMetric = bundle.backtests.length
    ? supported(
        "backtest_coverage",
        {
          successfulJobs: bundle.backtests.length,
          validationJobs: bundle.backtests.filter((item) => item.jobType === "run_backtest_validation").length,
          artifactCount: backtestEvidence.artifactIds.length,
        },
        bundle.backtests.length,
        3,
        "Tenant-verified successful Research Service job and artifact references; no performance inferred",
        backtestEvidence,
      )
    : insufficient("backtest_coverage", 0, 1, "Tenant-verified successful Research Service job references", backtestEvidence);

  return [
    numericOutcomeMetric(bundle, "risk_tolerance", (item) => item.riskUsed, 3, "Distribution of recorded risk-used values", "recorded risk units"),
    numericOutcomeMetric(bundle, "average_r", (item) => item.rMultiple, 3, "Distribution of recorded outcome R multiples", "R"),
    numericOutcomeMetric(bundle, "average_holding_time", (item) => item.holdingMs, 3, "Distribution of recorded outcome holding durations", "ms"),
    numericOutcomeMetric(bundle, "mae", (item) => item.mae, 3, "Distribution of recorded maximum adverse excursion", "recorded price/R units"),
    numericOutcomeMetric(bundle, "mfe", (item) => item.mfe, 3, "Distribution of recorded maximum favourable excursion", "recorded price/R units"),
    winLossMetric(bundle),
    sessionMetric,
    preferenceMetric(bundle, "preferred_symbols", (item) => item.symbol),
    preferenceMetric(bundle, "preferred_timeframes", (item) => item.timeframe),
    preferenceMetric(bundle, "preferred_strategies", (item) => item.strategyId),
    outcomeBehaviorMetric(bundle, "break_even_behavior", "BreakEven"),
    outcomeBehaviorMetric(bundle, "trailing_behavior", "Trailing"),
    riskScalingMetric(bundle),
    drawdownMetric(bundle),
    calibrationMetric(bundle),
    executionConsistencyMetric(bundle),
    portfolioConcentrationMetric(bundle),
    backtestMetric,
  ];
}

export function metricsEvidence(metrics: TradingDnaMetric[]): EvidenceReferences {
  return mergeEvidence(...metrics.filter((metric) => metric.status === "supported").map((metric) => metric.evidence));
}

export function allBundleEvidence(bundle: TradingDnaEvidenceBundle): EvidenceReferences {
  return evidenceFromBundle(bundle);
}
