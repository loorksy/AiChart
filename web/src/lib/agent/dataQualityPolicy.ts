/**
 * Canonical candle-coverage policy. Analysis, trade recommendation, and drawing
 * each have their own gate so the thresholds never drift apart between files.
 *
 * - Analysis may proceed below the trade threshold WITH warnings.
 * - A trade recommendation requires the trade threshold (else WAIT).
 * - Drawings / structural trendlines require the drawing threshold.
 * Insufficient coverage triggers refill upstream but never invents data.
 */
export const CANDLE_COVERAGE_POLICY_VERSION = "1.1.0";

export interface DataQualityThresholds {
  currentTf: number;
  higherTf: number;
  daily: number;
}

export const DATA_QUALITY_POLICY: {
  analysis: DataQualityThresholds;
  trade: DataQualityThresholds;
  drawing: DataQualityThresholds;
} = {
  analysis: { currentTf: 300, higherTf: 100, daily: 50 },
  trade: { currentTf: 500, higherTf: 200, daily: 100 },
  drawing: { currentTf: 500, higherTf: 200, daily: 100 },
};

/** Analysis kinds that can tighten or relax preferred history depth. */
export type CoverageAnalysisKind =
  | "scalp"
  | "intraday"
  | "swing"
  | "chart_analysis"
  | "drawing"
  | "trade";

export type CoverageStatus =
  | "sufficient"
  | "degraded_but_usable"
  | "insufficient"
  | "refill_required"
  | "refill_failed"
  | "stale"
  | "gapped";

export interface CandleCounts {
  currentTfCount: number;
  higherTfCount: number;
  dailyCount: number;
}

export interface PerTimeframeCoverage {
  interval: string;
  available: number;
  required: number;
  oldestTime: number | null;
  newestTime: number | null;
  status: CoverageStatus;
  source: string;
  refillAttempted: boolean;
  refillInserted: number;
  refillStatus: "not_needed" | "succeeded" | "partial" | "failed" | "skipped";
}

export interface CandleCoverageReport {
  policyVersion: string;
  analysisKind: CoverageAnalysisKind;
  gate: keyof typeof DATA_QUALITY_POLICY;
  status: CoverageStatus;
  sufficientForAnalysis: boolean;
  sufficientForTrade: boolean;
  sufficientForDrawing: boolean;
  timeframes: PerTimeframeCoverage[];
  summaryAr: string;
  summaryEn: string;
}

export function meetsDataQuality(
  counts: CandleCounts,
  gate: keyof typeof DATA_QUALITY_POLICY,
): boolean {
  const t = DATA_QUALITY_POLICY[gate];
  return (
    counts.currentTfCount >= t.currentTf &&
    counts.higherTfCount >= t.higherTf &&
    counts.dailyCount >= t.daily
  );
}

/**
 * Resolve thresholds by analysis kind. Scalp may use the analysis gate for
 * local structure, but trade/drawing still require the full trade gate.
 * Swing prefers deeper current-TF history (trade gate + 50%).
 */
export function resolveCoverageThresholds(
  analysisKind: CoverageAnalysisKind,
  gate: keyof typeof DATA_QUALITY_POLICY = "trade",
): DataQualityThresholds {
  const base = DATA_QUALITY_POLICY[gate];
  if (analysisKind === "swing" && gate !== "analysis") {
    return {
      currentTf: Math.ceil(base.currentTf * 1.5),
      higherTf: Math.ceil(base.higherTf * 1.25),
      daily: Math.ceil(base.daily * 1.25),
    };
  }
  if (analysisKind === "scalp" && gate === "analysis") {
    return {
      currentTf: Math.max(200, Math.floor(base.currentTf * 0.7)),
      higherTf: Math.max(80, Math.floor(base.higherTf * 0.8)),
      daily: Math.max(40, Math.floor(base.daily * 0.8)),
    };
  }
  return { ...base };
}

function frameStatus(
  available: number,
  required: number,
  refillAttempted: boolean,
  refillInserted: number,
  refillFailed: boolean,
): CoverageStatus {
  if (available >= required) return "sufficient";
  if (refillFailed) return "refill_failed";
  if (refillAttempted && refillInserted > 0 && available >= required * 0.7) {
    return "degraded_but_usable";
  }
  if (refillAttempted) return "refill_required";
  return "insufficient";
}

export function buildCandleCoverageReport(input: {
  analysisKind: CoverageAnalysisKind;
  gate?: keyof typeof DATA_QUALITY_POLICY;
  currentInterval: string;
  higherInterval: string;
  currentTfCount: number;
  higherTfCount: number;
  dailyCount: number;
  currentOldest?: number | null;
  currentNewest?: number | null;
  higherOldest?: number | null;
  higherNewest?: number | null;
  dailyOldest?: number | null;
  dailyNewest?: number | null;
  source?: string;
  refill?: {
    current?: { attempted: boolean; inserted: number; failed: boolean };
    higher?: { attempted: boolean; inserted: number; failed: boolean };
    daily?: { attempted: boolean; inserted: number; failed: boolean };
  };
}): CandleCoverageReport {
  const gate = input.gate ?? "trade";
  const required = resolveCoverageThresholds(input.analysisKind, gate);
  const source = input.source ?? "warehouse+oanda";

  const frames: PerTimeframeCoverage[] = [
    {
      interval: input.currentInterval,
      available: input.currentTfCount,
      required: required.currentTf,
      oldestTime: input.currentOldest ?? null,
      newestTime: input.currentNewest ?? null,
      status: frameStatus(
        input.currentTfCount,
        required.currentTf,
        input.refill?.current?.attempted ?? false,
        input.refill?.current?.inserted ?? 0,
        input.refill?.current?.failed ?? false,
      ),
      source,
      refillAttempted: input.refill?.current?.attempted ?? false,
      refillInserted: input.refill?.current?.inserted ?? 0,
      refillStatus: refillStatusOf(input.refill?.current),
    },
    {
      interval: input.higherInterval,
      available: input.higherTfCount,
      required: required.higherTf,
      oldestTime: input.higherOldest ?? null,
      newestTime: input.higherNewest ?? null,
      status: frameStatus(
        input.higherTfCount,
        required.higherTf,
        input.refill?.higher?.attempted ?? false,
        input.refill?.higher?.inserted ?? 0,
        input.refill?.higher?.failed ?? false,
      ),
      source,
      refillAttempted: input.refill?.higher?.attempted ?? false,
      refillInserted: input.refill?.higher?.inserted ?? 0,
      refillStatus: refillStatusOf(input.refill?.higher),
    },
    {
      interval: "1d",
      available: input.dailyCount,
      required: required.daily,
      oldestTime: input.dailyOldest ?? null,
      newestTime: input.dailyNewest ?? null,
      status: frameStatus(
        input.dailyCount,
        required.daily,
        input.refill?.daily?.attempted ?? false,
        input.refill?.daily?.inserted ?? 0,
        input.refill?.daily?.failed ?? false,
      ),
      source,
      refillAttempted: input.refill?.daily?.attempted ?? false,
      refillInserted: input.refill?.daily?.inserted ?? 0,
      refillStatus: refillStatusOf(input.refill?.daily),
    },
  ];

  const counts: CandleCounts = {
    currentTfCount: input.currentTfCount,
    higherTfCount: input.higherTfCount,
    dailyCount: input.dailyCount,
  };
  const sufficientForAnalysis = meetsDataQuality(counts, "analysis");
  const sufficientForTrade = meetsDataQuality(counts, "trade");
  const sufficientForDrawing = meetsDataQuality(counts, "drawing");

  const anyFailed = frames.some((f) => f.status === "refill_failed");
  const anyInsufficient = frames.some(
    (f) => f.available < f.required && f.status !== "sufficient",
  );
  const status: CoverageStatus = sufficientForTrade
    ? "sufficient"
    : anyFailed
      ? "refill_failed"
      : sufficientForAnalysis
        ? "degraded_but_usable"
        : anyInsufficient
          ? frames.some((f) => f.refillAttempted)
            ? "refill_required"
            : "insufficient"
          : "insufficient";

  const weak = frames.filter((f) => f.available < f.required);
  const detailAr = weak
    .map(
      (f) =>
        `${f.interval}: ${f.available}/${f.required}` +
        (f.refillAttempted
          ? ` (إعادة تعبئة: +${f.refillInserted}, ${f.refillStatus})`
          : ""),
    )
    .join(" · ");
  const detailEn = weak
    .map(
      (f) =>
        `${f.interval}: ${f.available}/${f.required}` +
        (f.refillAttempted
          ? ` (refill: +${f.refillInserted}, ${f.refillStatus})`
          : ""),
    )
    .join(" · ");

  const summaryAr = sufficientForTrade
    ? `تغطية الشموع كافية (${frames.map((f) => `${f.interval}:${f.available}`).join(", ")}).`
    : `انتظار — تغطية الشموع غير كافية. ${detailAr || "لا بيانات"}. لم تُنشأ توصية ولا خط اتجاه هيكلي.`;
  const summaryEn = sufficientForTrade
    ? `Candle coverage sufficient (${frames.map((f) => `${f.interval}:${f.available}`).join(", ")}).`
    : `WAIT — candle coverage insufficient. ${detailEn || "no data"}. No recommendation or structural trendline produced.`;

  return {
    policyVersion: CANDLE_COVERAGE_POLICY_VERSION,
    analysisKind: input.analysisKind,
    gate,
    status,
    sufficientForAnalysis,
    sufficientForTrade,
    sufficientForDrawing,
    timeframes: frames,
    summaryAr,
    summaryEn,
  };
}

function refillStatusOf(
  r: { attempted: boolean; inserted: number; failed: boolean } | undefined,
): PerTimeframeCoverage["refillStatus"] {
  if (!r?.attempted) return "not_needed";
  if (r.failed) return "failed";
  if (r.inserted > 0) return "succeeded";
  return "skipped";
}
