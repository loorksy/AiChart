import { hasEvidence, requireEvidence } from "./evidence";
import type {
  TradingDnaConclusion,
  TradingDnaConclusionType,
  TradingDnaMetric,
  TradingDnaMetricKey,
} from "./types";

function record(metric: TradingDnaMetric | undefined): Record<string, unknown> {
  return metric?.value && typeof metric.value === "object" && !Array.isArray(metric.value)
    ? metric.value
    : {};
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function add(
  conclusions: TradingDnaConclusion[],
  metric: TradingDnaMetric | undefined,
  type: TradingDnaConclusionType,
  text: string,
  suffix: string = type,
): void {
  if (!metric || metric.status !== "supported" || !hasEvidence(metric.evidence)) return;
  const conclusion: TradingDnaConclusion = {
    id: `dna:${metric.key}:${suffix}`,
    type,
    text: text.slice(0, 500),
    confidence: metric.confidence,
    evidence: metric.evidence,
  };
  requireEvidence(conclusion.evidence, conclusion.id);
  conclusions.push(conclusion);
}

function metricMap(metrics: TradingDnaMetric[]): Map<TradingDnaMetricKey, TradingDnaMetric> {
  return new Map(metrics.map((metric) => [metric.key, metric]));
}

function topKey(metric: TradingDnaMetric | undefined): string | undefined {
  if (!metric || !Array.isArray(metric.value)) return undefined;
  const first = metric.value[0];
  return typeof first?.key === "string" ? first.key : undefined;
}

export function buildTradingDnaConclusions(metrics: TradingDnaMetric[]): TradingDnaConclusion[] {
  const byKey = metricMap(metrics);
  const conclusions: TradingDnaConclusion[] = [];

  const winLoss = byKey.get("win_loss_behavior");
  const winRate = number(record(winLoss).winRate);
  if (winRate != null) {
    if (winRate >= 0.6) {
      add(conclusions, winLoss, "strength", `Recorded win rate is ${(winRate * 100).toFixed(1)}%.`, "win-rate-strength");
    } else if (winRate < 0.4) {
      add(conclusions, winLoss, "weakness", `Recorded win rate is ${(winRate * 100).toFixed(1)}%.`, "win-rate-weakness");
      add(conclusions, winLoss, "improvement", "Review the evidence-linked losing recommendations before increasing risk.", "win-rate-action");
    } else {
      add(conclusions, winLoss, "pattern", `Recorded win rate is ${(winRate * 100).toFixed(1)}%.`, "win-rate-pattern");
    }
  }

  const averageR = byKey.get("average_r");
  const rAverage = number(record(averageR).average);
  if (rAverage != null) {
    add(
      conclusions,
      averageR,
      rAverage > 0 ? "strength" : "weakness",
      `Average recorded outcome is ${rAverage.toFixed(2)}R.`,
      rAverage > 0 ? "positive-r" : "non-positive-r",
    );
    if (rAverage <= 0) {
      add(conclusions, averageR, "improvement", "Prioritize setups whose recorded R evidence is positive before scaling exposure.", "r-action");
    }
  }

  const risk = byKey.get("risk_tolerance");
  const riskAverage = number(record(risk).average);
  if (riskAverage != null) {
    add(conclusions, risk, "risk_profile", `Average recorded risk used is ${riskAverage.toFixed(2)} in the source risk units.`, "risk-used");
  }

  const holding = byKey.get("average_holding_time");
  const holdingAverage = number(record(holding).average);
  if (holdingAverage != null) {
    add(conclusions, holding, "pattern", `Average recorded holding time is ${(holdingAverage / 3_600_000).toFixed(2)} hours.`, "holding-time");
  }

  const symbol = byKey.get("preferred_symbols");
  const dominantSymbol = topKey(symbol);
  if (dominantSymbol) add(conclusions, symbol, "pattern", `Most frequently observed symbol is ${dominantSymbol}.`, "symbol");

  const timeframe = byKey.get("preferred_timeframes");
  const dominantTimeframe = topKey(timeframe);
  if (dominantTimeframe) add(conclusions, timeframe, "strategy_profile", `Most frequently observed timeframe is ${dominantTimeframe}.`, "timeframe");

  const strategy = byKey.get("preferred_strategies");
  const dominantStrategy = topKey(strategy);
  if (dominantStrategy) add(conclusions, strategy, "strategy_profile", `Most frequently observed strategy is ${dominantStrategy}.`, "strategy");

  const sessions = byKey.get("preferred_sessions");
  const dominantSession = topKey(sessions);
  if (dominantSession) add(conclusions, sessions, "pattern", `Most recommendation evidence occurs in the ${dominantSession} UTC session bucket.`, "session");

  const breakEven = byKey.get("break_even_behavior");
  const breakEvenRate = number(record(breakEven).rate);
  if (breakEvenRate != null) add(conclusions, breakEven, "pattern", `Break-even outcomes occur in ${(breakEvenRate * 100).toFixed(1)}% of completed recommendation evidence.`, "break-even");

  const trailing = byKey.get("trailing_behavior");
  const trailingRate = number(record(trailing).rate);
  if (trailingRate != null) add(conclusions, trailing, "pattern", `Trailing activation occurs in ${(trailingRate * 100).toFixed(1)}% of completed recommendation evidence.`, "trailing");

  const calibration = byKey.get("confidence_calibration");
  const calibrationError = number(record(calibration).meanAbsoluteError);
  if (calibrationError != null) {
    add(
      conclusions,
      calibration,
      calibrationError <= 0.15 ? "confidence_profile" : "weakness",
      `Confidence mean absolute calibration error is ${(calibrationError * 100).toFixed(1)} percentage points.`,
      "calibration",
    );
    if (calibrationError > 0.2) add(conclusions, calibration, "improvement", "Recalibrate recommendation confidence against the linked success and failure events.", "calibration-action");
  }

  const execution = byKey.get("execution_consistency");
  const coefficient = number(record(execution).coefficientOfVariation);
  if (coefficient != null) {
    add(
      conclusions,
      execution,
      coefficient <= 0.5 ? "strength" : "weakness",
      `Recorded execution-cost coefficient of variation is ${coefficient.toFixed(2)}.`,
      "execution-variation",
    );
    if (coefficient > 1) add(conclusions, execution, "improvement", "Investigate the linked high-variation execution-cost outcomes.", "execution-action");
  }

  const concentration = byKey.get("portfolio_concentration");
  const dominantShare = number(record(concentration).dominantShare);
  if (dominantShare != null) {
    add(conclusions, concentration, "risk_profile", `The dominant symbol represents ${(dominantShare * 100).toFixed(1)}% of recommendation evidence.`, "concentration");
    if (dominantShare > 0.7) add(conclusions, concentration, "improvement", "Review whether the evidence-linked symbol concentration matches the intended risk profile.", "concentration-action");
  }

  const drawdown = byKey.get("drawdown_recovery");
  const maxDrawdown = number(record(drawdown).maximumDrawdown);
  const recovered = record(drawdown).recovered;
  if (maxDrawdown != null) {
    add(conclusions, drawdown, "risk_profile", `Maximum recorded outcome-path drawdown is ${maxDrawdown.toFixed(2)} in its recorded units; recovery observed: ${recovered === true ? "yes" : "no"}.`, "drawdown");
    if (recovered !== true) add(conclusions, drawdown, "improvement", "Keep risk scaling conservative until the linked outcome path records a recovery.", "drawdown-action");
  }

  return conclusions.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
}
