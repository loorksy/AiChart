/**
 * Distinct confidence semantics. These fields must never be silently
 * substituted for one another in the UI or persistence layer.
 */
export type ConfidenceValue = number | "not_applicable";

export type ConfidenceDisplayKind =
  | "none"
  | "analysis"
  | "decision"
  | "recommendation";

export interface ConfidenceFactor {
  factor: string;
  status: string;
  effect: string;
}

export interface ConfidenceSemantics {
  analysisConfidence: ConfidenceValue;
  decisionConfidence: ConfidenceValue;
  dataQuality: ConfidenceValue;
  setupQuality: ConfidenceValue;
  recommendationConfidence: ConfidenceValue;
  executionReadiness: ConfidenceValue;
  displayKind: ConfidenceDisplayKind;
  /** i18n key for the badge label when displayKind is not "none". */
  displayLabelKey:
    | "agent.confidence"
    | "agent.analysis_confidence"
    | "agent.decision_confidence"
    | "agent.recommendation_confidence";
  /** Value shown in the badge (0–1), or not_applicable. */
  displayValue: ConfidenceValue;
  factors: ConfidenceFactor[];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function buildInformationalConfidence(input: {
  analysisConfidence?: number;
}): ConfidenceSemantics {
  const analysis = clamp01(input.analysisConfidence ?? 0.75);
  return {
    analysisConfidence: analysis,
    decisionConfidence: "not_applicable",
    dataQuality: "not_applicable",
    setupQuality: "not_applicable",
    recommendationConfidence: "not_applicable",
    executionReadiness: "not_applicable",
    displayKind: "none",
    displayLabelKey: "agent.confidence",
    displayValue: "not_applicable",
    factors: [],
  };
}

/**
 * Confidence for a direction that has no confirmed levels yet.
 *
 * The model has a view and states it; what it does not have is an entry it can
 * stand behind. So decision confidence is reported and recommendation
 * confidence stays not_applicable — showing a trade-grade percentage for a plan
 * with no numbers would misrepresent what the operator is being handed.
 */
export function buildDirectionalConfidence(input: {
  decisionConfidence: number;
  dataQualityScore: number;
  setupQuality?: number | null;
  reasons: string[];
}): ConfidenceSemantics {
  const decision = clamp01(input.decisionConfidence);
  const dataQuality = clamp01(input.dataQualityScore);
  const setup =
    input.setupQuality == null
      ? ("not_applicable" as const)
      : clamp01(input.setupQuality);
  const factors: ConfidenceFactor[] = [
    {
      factor: "data_quality",
      status: dataQuality >= 0.8 ? "ok" : dataQuality >= 0.5 ? "degraded" : "insufficient",
      effect: "coverage behind the directional read",
    },
    {
      factor: "levels",
      status: "unconfirmed",
      effect: "direction stated without confirmed entry levels",
    },
  ];
  for (const reason of input.reasons.slice(0, 3)) {
    factors.push({
      factor: "reason",
      status: "supporting",
      effect: reason.slice(0, 160),
    });
  }
  return {
    analysisConfidence: clamp01((decision + dataQuality) / 2),
    decisionConfidence: decision,
    dataQuality,
    setupQuality: setup,
    recommendationConfidence: "not_applicable",
    executionReadiness: "not_applicable",
    displayKind: "decision",
    displayLabelKey: "agent.decision_confidence",
    displayValue: decision,
    factors,
  };
}

export function buildRecommendationConfidence(input: {
  base: number;
  dataQualityScore: number;
  setupQuality: number | null;
  newsRisk: "low" | "medium" | "high" | "unknown";
  dataSufficientForTrade: boolean;
}): ConfidenceSemantics {
  // The decision model already receives these evidence fields and owns the
  // resulting confidence. Preserve its value; never apply a hidden policy cap.
  const recommendation = clamp01(input.base);

  return {
    analysisConfidence: clamp01(input.base),
    decisionConfidence: clamp01(input.base),
    dataQuality: clamp01(input.dataQualityScore),
    setupQuality:
      input.setupQuality == null
        ? "not_applicable"
        : clamp01(input.setupQuality),
    recommendationConfidence: recommendation,
    executionReadiness: "not_applicable",
    displayKind: "recommendation",
    displayLabelKey: "agent.recommendation_confidence",
    displayValue: recommendation,
    factors: [
      ...(input.setupQuality == null
        ? []
        : [{
            factor: "setup_quality",
            status: input.setupQuality >= 0.75 ? "strong" : "moderate",
            effect: `setup quality ${Math.round(input.setupQuality * 100)}%`,
          }]),
      {
        factor: "data_quality",
        status: input.dataSufficientForTrade ? "ok" : "insufficient",
        effect: input.dataSufficientForTrade
          ? "coverage meets trade gate"
          : "coverage below trade gate",
      },
      {
        factor: "news_risk",
        status: input.newsRisk,
        effect: `news risk ${input.newsRisk}`,
      },
    ],
  };
}

/** Score data quality 0–1 from coverage counts vs trade gate. */
export function scoreDataQuality(input: {
  sufficientForTrade: boolean;
  sufficientForAnalysis: boolean;
  currentRatio: number;
  higherRatio: number;
  dailyRatio: number;
}): number {
  if (input.sufficientForTrade) return 1;
  const avg =
    (clamp01(input.currentRatio) +
      clamp01(input.higherRatio) +
      clamp01(input.dailyRatio)) /
    3;
  if (input.sufficientForAnalysis) return Math.max(0.55, avg * 0.85);
  return Math.max(0.15, avg * 0.6);
}
