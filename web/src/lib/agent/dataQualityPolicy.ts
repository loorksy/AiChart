/**
 * Canonical candle-coverage policy. Analysis, trade recommendation, and drawing
 * each have their own gate so the thresholds never drift apart between files.
 *
 * - Analysis may proceed below the trade threshold WITH warnings.
 * - A trade recommendation requires the trade threshold; below it the run ends
 *   as a named operational blocker, never as a market decision to wait.
 * - Drawings / structural trendlines require the drawing threshold.
 * Insufficient coverage triggers refill upstream but never invents data.
 */
export const CANDLE_COVERAGE_POLICY_VERSION = "1.2.0";

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
  /** Significant missing open-market bars always fail every analysis gate. */
  hasCriticalGaps?: boolean;
}

export interface CandleGapEvidence {
  missingBars: number;
}

/**
 * Gap severity ladder (policy v1.2):
 *   none         — no missing open-market bars.
 *   minor        — isolated missing bars; normal provider noise, no action.
 *   significant  — worth a warning and an automatic repair job, but analysis
 *                  PROCEEDS; the model weighs it as evidence.
 *   catastrophic — so much data is missing that analysis output would be
 *                  meaningless; the only tier that still blocks.
 *
 * The previous absolute policy (any 2-bar gap, or >2 missing bars total)
 * blocked analysis permanently on healthy series because session-boundary
 * bars misclassified as "missing" accumulate with window size. Thresholds are
 * therefore RELATIVE to the inspected window, with env overrides.
 */
export type CandleGapSeverity = "none" | "minor" | "significant" | "catastrophic";

const GAP_SEVERITY_ORDER: Record<CandleGapSeverity, number> = {
  none: 0,
  minor: 1,
  significant: 2,
  catastrophic: 3,
};

export function worstGapSeverity(
  severities: readonly CandleGapSeverity[],
): CandleGapSeverity {
  let worst: CandleGapSeverity = "none";
  for (const severity of severities) {
    if (GAP_SEVERITY_ORDER[severity] > GAP_SEVERITY_ORDER[worst]) worst = severity;
  }
  return worst;
}

export interface CandleGapSummary {
  gapCount: number;
  missingBars: number;
  largestGapBars: number;
  gapSeverity: CandleGapSeverity;
  /** True only for the catastrophic tier — the sole remaining hard block. */
  hasCriticalGaps: boolean;
}

export interface CandleGapPolicy {
  /** Single-gap run length tolerated without a warning. */
  maxSingleGapBars: number;
  /** Total missing bars tolerated without a warning (ratio × window). */
  maxTotalMissingBars: number;
  /** Single-gap run length that alone makes the series unusable. */
  catastrophicSingleGapBars: number;
  /** Total missing bars that make the series unusable (ratio × window). */
  catastrophicMissingBars: number;
}

const DEFAULT_MAX_SINGLE_GAP_BARS = 3;
const DEFAULT_MAX_MISSING_RATIO = 0.02;
const DEFAULT_CATASTROPHIC_SINGLE_GAP_BARS = 20;
const DEFAULT_CATASTROPHIC_MISSING_RATIO = 0.1;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function envRatio(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1) return fallback;
  return raw;
}

/** Window-relative gap thresholds. `windowBars` = bars available in the scan. */
export function resolveGapPolicy(windowBars: number): CandleGapPolicy {
  const window = Math.max(1, Math.floor(windowBars));
  const maxSingleGapBars = envInt("CANDLE_GAP_MAX_SINGLE_BARS", DEFAULT_MAX_SINGLE_GAP_BARS, 1, 100);
  const missingRatio = envRatio("CANDLE_GAP_MAX_MISSING_RATIO", DEFAULT_MAX_MISSING_RATIO);
  const catastrophicSingleGapBars = envInt(
    "CANDLE_GAP_CATASTROPHIC_SINGLE_BARS",
    DEFAULT_CATASTROPHIC_SINGLE_GAP_BARS,
    5,
    10_000,
  );
  const catastrophicRatio = envRatio(
    "CANDLE_GAP_CATASTROPHIC_RATIO",
    DEFAULT_CATASTROPHIC_MISSING_RATIO,
  );
  return {
    maxSingleGapBars,
    maxTotalMissingBars: Math.max(
      maxSingleGapBars,
      Math.ceil(window * missingRatio),
    ),
    catastrophicSingleGapBars,
    // Floored at 10 (not at the single-gap threshold) so the ratio path stays
    // reachable for small windows like the 100-bar daily frame.
    catastrophicMissingBars: Math.max(10, Math.ceil(window * catastrophicRatio)),
  };
}

/** @deprecated v1.1 absolute thresholds — kept for reference in stored reports. */
export const IMPORTANT_CANDLE_GAP_POLICY = {
  maxSingleGapBars: 1,
  maxTotalMissingBars: 2,
} as const;

export function summarizeCandleGaps(
  gaps: readonly CandleGapEvidence[] = [],
  windowBars = 500,
): CandleGapSummary {
  const missingByGap = gaps
    .map((gap) => Math.max(0, Math.floor(Number(gap.missingBars))))
    .filter((missing) => missing > 0);
  const missingBars = missingByGap.reduce((sum, missing) => sum + missing, 0);
  const largestGapBars = Math.max(0, ...missingByGap);
  const policy = resolveGapPolicy(windowBars);

  const gapSeverity: CandleGapSeverity =
    largestGapBars >= policy.catastrophicSingleGapBars ||
    missingBars >= policy.catastrophicMissingBars
      ? "catastrophic"
      : largestGapBars > policy.maxSingleGapBars ||
          missingBars > policy.maxTotalMissingBars
        ? "significant"
        : missingBars > 0
          ? "minor"
          : "none";

  return {
    gapCount: missingByGap.length,
    missingBars,
    largestGapBars,
    gapSeverity,
    hasCriticalGaps: gapSeverity === "catastrophic",
  };
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
  gapCount: number;
  missingBars: number;
  largestGapBars: number;
  gapSeverity: CandleGapSeverity;
  hasCriticalGaps: boolean;
}

export interface CandleCoverageReport {
  policyVersion: string;
  analysisKind: CoverageAnalysisKind;
  gate: keyof typeof DATA_QUALITY_POLICY;
  status: CoverageStatus;
  sufficientForAnalysis: boolean;
  sufficientForTrade: boolean;
  sufficientForDrawing: boolean;
  /** Present on reports generated by v1.1+; optional for stored legacy reports. */
  hasCriticalGaps?: boolean;
  /** Worst gap severity across frames (v1.2+; absent on stored legacy reports). */
  gapSeverity?: CandleGapSeverity;
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
    !counts.hasCriticalGaps &&
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
  gaps: CandleGapSummary,
): CoverageStatus {
  if (gaps.hasCriticalGaps) return "gapped";
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
  gaps?: {
    current?: readonly CandleGapEvidence[];
    higher?: readonly CandleGapEvidence[];
    daily?: readonly CandleGapEvidence[];
  };
  refill?: {
    current?: { attempted: boolean; inserted: number; failed: boolean };
    higher?: { attempted: boolean; inserted: number; failed: boolean };
    daily?: { attempted: boolean; inserted: number; failed: boolean };
  };
}): CandleCoverageReport {
  const gate = input.gate ?? "trade";
  const required = resolveCoverageThresholds(input.analysisKind, gate);
  const source = input.source ?? "warehouse+oanda";
  // Severity is window-relative: the same 5 missing bars are noise in a
  // 500-bar frame and a real problem in a 100-bar daily frame.
  const gapSummaries = {
    current: summarizeCandleGaps(
      input.gaps?.current,
      Math.max(input.currentTfCount, required.currentTf),
    ),
    higher: summarizeCandleGaps(
      input.gaps?.higher,
      Math.max(input.higherTfCount, required.higherTf),
    ),
    daily: summarizeCandleGaps(
      input.gaps?.daily,
      Math.max(input.dailyCount, required.daily),
    ),
  };

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
        gapSummaries.current,
      ),
      source,
      refillAttempted: input.refill?.current?.attempted ?? false,
      refillInserted: input.refill?.current?.inserted ?? 0,
      refillStatus: refillStatusOf(input.refill?.current),
      ...gapSummaries.current,
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
        gapSummaries.higher,
      ),
      source,
      refillAttempted: input.refill?.higher?.attempted ?? false,
      refillInserted: input.refill?.higher?.inserted ?? 0,
      refillStatus: refillStatusOf(input.refill?.higher),
      ...gapSummaries.higher,
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
        gapSummaries.daily,
      ),
      source,
      refillAttempted: input.refill?.daily?.attempted ?? false,
      refillInserted: input.refill?.daily?.inserted ?? 0,
      refillStatus: refillStatusOf(input.refill?.daily),
      ...gapSummaries.daily,
    },
  ];

  const gapSeverity = worstGapSeverity(
    Object.values(gapSummaries).map((summary) => summary.gapSeverity),
  );
  const counts: CandleCounts = {
    currentTfCount: input.currentTfCount,
    higherTfCount: input.higherTfCount,
    dailyCount: input.dailyCount,
    hasCriticalGaps: gapSeverity === "catastrophic",
  };
  const sufficientForAnalysis = meetsDataQuality(counts, "analysis");
  const sufficientForTrade = meetsDataQuality(counts, "trade");
  const sufficientForDrawing = meetsDataQuality(counts, "drawing");
  const hasCriticalGaps = counts.hasCriticalGaps === true;

  const anyFailed = frames.some((f) => f.status === "refill_failed");
  const anyInsufficient = frames.some(
    (f) => f.available < f.required && f.status !== "sufficient",
  );
  const status: CoverageStatus = hasCriticalGaps
    ? "gapped"
    : sufficientForTrade
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

  // Detail lines cover every frame with warning-level gaps or worse, so the
  // significant-tier warning names the affected frames too.
  const gapped = frames.filter(
    (frame) =>
      frame.gapSeverity === "significant" || frame.gapSeverity === "catastrophic",
  );
  const gapDetailAr = gapped
    .map(
      (frame) =>
        `${frame.interval}: ${frame.missingBars} شمعة مفقودة ضمن ${frame.gapCount} فجوة`,
    )
    .join(" · ");
  const gapDetailEn = gapped
    .map(
      (frame) =>
        `${frame.interval}: ${frame.missingBars} missing bar(s) across ${frame.gapCount} gap(s)`,
    )
    .join(" · ");

  const significantGapNoteAr =
    gapSeverity === "significant"
      ? ` تنبيه: فجوات بيانات ملحوظة (${gapDetailAr}) — بدأ الإصلاح التلقائي وتستمر المعالجة مع خفض الثقة بالأدلة المتأثرة.`
      : "";
  const significantGapNoteEn =
    gapSeverity === "significant"
      ? ` Note: noticeable data gaps (${gapDetailEn}) — automatic repair started; analysis continues with reduced weight on affected evidence.`
      : "";

  const summaryAr = hasCriticalGaps
    ? `فجوات بيانات حرجة أثناء فتح السوق. ${gapDetailAr}. بدأ الإصلاح التلقائي — أعد المحاولة خلال دقائق.`
    : sufficientForTrade
      ? `تغطية الشموع كافية (${frames.map((f) => `${f.interval}:${f.available}`).join(", ")}).${significantGapNoteAr}`
      : `تغطية الشموع غير كافية. ${detailAr || "لا بيانات"}. عائق تشغيلي: لم تُنشأ توصية ولا خط اتجاه هيكلي.${significantGapNoteAr}`;
  const summaryEn = hasCriticalGaps
    ? `Catastrophic open-market candle gaps. ${gapDetailEn}. Automatic repair started — retry in a few minutes.`
    : sufficientForTrade
      ? `Candle coverage sufficient (${frames.map((f) => `${f.interval}:${f.available}`).join(", ")}).${significantGapNoteEn}`
      : `Candle coverage insufficient. ${detailEn || "no data"}. Operational blocker: no recommendation or structural trendline produced.${significantGapNoteEn}`;

  return {
    policyVersion: CANDLE_COVERAGE_POLICY_VERSION,
    analysisKind: input.analysisKind,
    gate,
    status,
    sufficientForAnalysis,
    sufficientForTrade,
    sufficientForDrawing,
    hasCriticalGaps,
    gapSeverity,
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
