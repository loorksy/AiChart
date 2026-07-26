/**
 * Portfolio-level execution gate (RELIABILITY_PLAN.md item 16).
 *
 * The Risk Agent judges each trade ALONE. Five "safe" 1%-risk longs on
 * correlated USD pairs are five expressions of one bet — individually fine,
 * collectively a 5% directional position nobody approved. This gate closes
 * that hole using data the platform already has (portfolio + open trades).
 *
 * Strictly an EXECUTION gate: it runs after the model has decided and can only
 * BLOCK or WARN. It never edits the decision, never changes BUY/SELL/WAIT, and
 * never relaxes any existing check.
 */

export interface OpenPositionView {
  symbol: string;
  direction: "buy" | "sell";
  /** Risked fraction of equity for this position (0.01 = 1%). */
  riskFraction: number;
}

export interface PortfolioLimits {
  /** Max total risked fraction across all open positions. */
  maxTotalRiskFraction: number;
  /** Max risked fraction in one correlation group + direction. */
  maxCorrelatedRiskFraction: number;
  /** Max simultaneous open positions. */
  maxOpenPositions: number;
  /** Realised daily loss fraction at which new entries stop. */
  maxDailyLossFraction: number;
}

export const DEFAULT_PORTFOLIO_LIMITS: PortfolioLimits = {
  maxTotalRiskFraction: 0.06,
  maxCorrelatedRiskFraction: 0.03,
  maxOpenPositions: 5,
  maxDailyLossFraction: 0.05,
};

export type PortfolioBlockCode =
  | "daily_loss_limit"
  | "max_open_positions"
  | "total_risk_limit"
  | "correlated_risk_limit";

export interface PortfolioVerdict {
  allowed: boolean;
  code?: PortfolioBlockCode;
  /** Operator-facing sentence. Never internal vocabulary. */
  reason?: string;
  /** Non-blocking observations worth showing with the recommendation. */
  warnings: string[];
  totals: {
    totalRiskFraction: number;
    correlatedRiskFraction: number;
    openPositions: number;
  };
}

/**
 * Correlation grouping. Deliberately coarse and explicit rather than a
 * statistical estimate: a wrong-but-conservative grouping costs one skipped
 * trade, while a missed correlation costs a concentrated loss. Metals and the
 * major USD pairs are grouped by their shared driver.
 */
export function correlationGroup(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  if (s.startsWith("XAU") || s.startsWith("XAG")) return "metals";
  const base = s.slice(0, 3);
  const quote = s.slice(3, 6);
  // A USD pair's risk is a USD-direction bet either way.
  if (base === "USD" || quote === "USD") return `usd:${base === "USD" ? quote : base}`;
  return `cross:${base}${quote}`;
}

/**
 * Would adding `candidate` breach a portfolio limit? Safety-first ordering:
 * the daily loss stop outranks everything, then position count, then total
 * risk, then correlated concentration.
 */
export function evaluatePortfolioGate(input: {
  candidate: OpenPositionView;
  openPositions: readonly OpenPositionView[];
  /** Realised loss today as a POSITIVE fraction of equity (0.02 = −2%). */
  realisedDailyLossFraction?: number;
  limits?: Partial<PortfolioLimits>;
}): PortfolioVerdict {
  const limits = { ...DEFAULT_PORTFOLIO_LIMITS, ...(input.limits ?? {}) };
  const open = input.openPositions;
  const warnings: string[] = [];

  const existingRisk = open.reduce((sum, p) => sum + Math.max(0, p.riskFraction), 0);
  const totalRiskFraction = existingRisk + Math.max(0, input.candidate.riskFraction);

  const group = correlationGroup(input.candidate.symbol);
  const correlatedRiskFraction =
    open
      .filter(
        (p) =>
          correlationGroup(p.symbol) === group && p.direction === input.candidate.direction,
      )
      .reduce((sum, p) => sum + Math.max(0, p.riskFraction), 0) +
    Math.max(0, input.candidate.riskFraction);

  const totals = {
    totalRiskFraction,
    correlatedRiskFraction,
    openPositions: open.length + 1,
  };

  const dailyLoss = Math.max(0, input.realisedDailyLossFraction ?? 0);
  if (dailyLoss >= limits.maxDailyLossFraction) {
    return {
      allowed: false,
      code: "daily_loss_limit",
      reason: "بلغت خسارة اليوم الحد المسموح؛ لا تُفتح صفقات جديدة اليوم.",
      warnings,
      totals,
    };
  }

  if (totals.openPositions > limits.maxOpenPositions) {
    return {
      allowed: false,
      code: "max_open_positions",
      reason: "عدد الصفقات المفتوحة بلغ الحد الأقصى.",
      warnings,
      totals,
    };
  }

  if (totalRiskFraction > limits.maxTotalRiskFraction) {
    return {
      allowed: false,
      code: "total_risk_limit",
      reason: "إجمالي المخاطرة المفتوحة سيتجاوز الحد المسموح بإضافة هذه الصفقة.",
      warnings,
      totals,
    };
  }

  if (correlatedRiskFraction > limits.maxCorrelatedRiskFraction) {
    return {
      allowed: false,
      code: "correlated_risk_limit",
      reason:
        "هذه الصفقة تكرّر اتجاهاً مفتوحاً على أدوات مترابطة — التركيز يتجاوز الحد المسموح.",
      warnings,
      totals,
    };
  }

  // Non-blocking early warnings at 80% of a limit.
  if (totalRiskFraction > limits.maxTotalRiskFraction * 0.8) {
    warnings.push("إجمالي المخاطرة المفتوحة يقترب من الحد المسموح.");
  }
  if (correlatedRiskFraction > limits.maxCorrelatedRiskFraction * 0.8) {
    warnings.push("التركيز على أدوات مترابطة يقترب من الحد المسموح.");
  }

  return { allowed: true, warnings, totals };
}
