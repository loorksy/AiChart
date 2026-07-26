/**
 * The evidence card, reported dimension by dimension
 * (docs/UNIFIED_AGENT_PLAN.md §13).
 *
 * One blended percentage hides exactly what the operator needs: a plan can rest
 * on strong structure while having no statistical history behind it, or sit in
 * a perfect zone that costs more in spread than it can return. Each dimension
 * therefore keeps its own grade and its own short reason, and "unavailable" is
 * a first-class answer — an absent backtest is reported as absent, never
 * softened into a number.
 */

export type DimensionGrade = "strong" | "moderate" | "weak" | "unavailable";

export interface EvidenceDimension {
  /** Stable machine key (UI labels are localized from it). */
  key: string;
  grade: DimensionGrade;
  /** One short operator-facing sentence; never machine internals. */
  detail: string;
  /** Optional measured value behind the grade (percent, count, R…). */
  value?: number | string;
}

export interface EvidenceDimensions {
  dimensions: EvidenceDimension[];
}

function dim(
  key: string,
  grade: DimensionGrade,
  detail: string,
  value?: number | string,
): EvidenceDimension {
  return value === undefined ? { key, grade, detail } : { key, grade, detail, value };
}

export interface BuildEvidenceDimensionsInput {
  planType: "immediate" | "anticipatory" | "conditional";
  executionState: string;
  /** The model's own read of the live setup, 0–1. */
  signalStrength: number;
  /** Multi-timeframe agreement, when the timeframe agents ran. */
  timeframeAgreement?: "aligned" | "conflicting" | "unknown";
  /** Deterministic pattern state, e.g. "ascending_triangle · forming 72%". */
  patternState?: string | null;
  patternCompletion?: number | null;
  /** POI/zone quality 0–100 from the candidate engine. */
  entryQuality?: number | null;
  /** Net R for TP1 after modelled spread and slippage. */
  netR?: number | null;
  belowPreferredNetR?: boolean;
  /** Statistical backing actually verified on the server — never assumed. */
  statisticalSupport?: "strong" | "moderate" | "weak" | "unavailable";
  statisticalDetail?: string | null;
  /** Similar historical cases, once the case memory exists. */
  historicalCases?: { count: number; winRate?: number | null } | null;
  newsRisk?: "low" | "medium" | "high" | "unknown";
  /** Whether coverage met the trade gate. */
  dataSufficient: boolean;
  /** Visual review outcome when charts were actually read. */
  visualConfirmation?: "confirmed" | "contradicted" | "not_checked";
  validityCandles?: number | null;
  executionReadiness?: { ready: boolean; reason?: string } | null;
  /** Operator's current trade mode, so the card says what would happen next. */
  tradeMode?: "auto" | "advisory" | "unavailable";
}

/**
 * Build the card. Every dimension is always present so the operator can see
 * what is missing as clearly as what is strong.
 */
export function buildEvidenceDimensions(
  input: BuildEvidenceDimensionsInput,
): EvidenceDimensions {
  const dimensions: EvidenceDimension[] = [];

  const signalPct = Math.round(Math.max(0, Math.min(1, input.signalStrength)) * 100);
  dimensions.push(
    dim(
      "signal_strength",
      signalPct >= 70 ? "strong" : signalPct >= 45 ? "moderate" : "weak",
      `قوة الإشارة الحالية ${signalPct}%.`,
      signalPct,
    ),
  );

  dimensions.push(
    dim("plan_type", "moderate", planTypeDetail(input.planType, input.executionState)),
  );

  const agreement = input.timeframeAgreement ?? "unknown";
  dimensions.push(
    dim(
      "timeframe_agreement",
      agreement === "aligned" ? "strong" : agreement === "conflicting" ? "weak" : "unavailable",
      agreement === "aligned"
        ? "الفريمات متوافقة على الاتجاه."
        : agreement === "conflicting"
          ? "الفريمات متعارضة — القرار يحدد الفريم القائد."
          : "لم تُقيَّم علاقة الفريمات.",
    ),
  );

  if (input.patternState) {
    const completion = input.patternCompletion ?? null;
    dimensions.push(
      dim(
        "pattern_state",
        completion == null ? "moderate" : completion >= 0.8 ? "strong" : "moderate",
        completion == null
          ? `النموذج: ${input.patternState}.`
          : `النموذج: ${input.patternState} (اكتمال ≈${Math.round(completion * 100)}%).`,
        completion == null ? undefined : Math.round(completion * 100),
      ),
    );
  } else {
    dimensions.push(
      dim("pattern_state", "unavailable", "لا يوجد نموذج معروف مكتشف — البنية موصوفة كما هي."),
    );
  }

  if (input.entryQuality != null) {
    dimensions.push(
      dim(
        "entry_quality",
        input.entryQuality >= 75 ? "strong" : input.entryQuality >= 55 ? "moderate" : "weak",
        `جودة منطقة الدخول ${Math.round(input.entryQuality)}/100.`,
        Math.round(input.entryQuality),
      ),
    );
  } else {
    dimensions.push(dim("entry_quality", "unavailable", "لم تُحدَّد منطقة دخول مقيَّمة بعد."));
  }

  if (input.netR != null) {
    dimensions.push(
      dim(
        "cost_impact",
        input.belowPreferredNetR ? "weak" : input.netR >= 3 ? "strong" : "moderate",
        input.belowPreferredNetR
          ? `العائد الصافي بعد التكاليف ضعيف (≈${input.netR.toFixed(2)}R).`
          : `العائد الصافي بعد التكاليف ≈${input.netR.toFixed(2)}R.`,
        Number(input.netR.toFixed(2)),
      ),
    );
  } else {
    dimensions.push(dim("cost_impact", "unavailable", "لا مستويات بعد لحساب العائد الصافي."));
  }

  const support = input.statisticalSupport ?? "unavailable";
  dimensions.push(
    dim(
      "statistical_support",
      support,
      input.statisticalDetail?.trim() ||
        (support === "unavailable"
          ? "لا يتوفر دعم إحصائي — القرار مبني على التحليل المباشر."
          : `الدعم الإحصائي: ${support}.`),
    ),
  );

  if (input.historicalCases && input.historicalCases.count > 0) {
    const { count, winRate } = input.historicalCases;
    dimensions.push(
      dim(
        "historical_cases",
        count >= 30 ? "strong" : count >= 10 ? "moderate" : "weak",
        winRate == null
          ? `${count} حالة تاريخية مشابهة.`
          : `${count} حالة مشابهة، تحقق الهدف في ${Math.round(winRate * 100)}%.`,
        count,
      ),
    );
  } else {
    dimensions.push(
      dim("historical_cases", "unavailable", "لا حالات تاريخية مشابهة كافية — تحليل مباشر."),
    );
  }

  const news = input.newsRisk ?? "unknown";
  dimensions.push(
    dim(
      "news_impact",
      news === "low" ? "strong" : news === "medium" ? "moderate" : news === "high" ? "weak" : "unavailable",
      news === "unknown"
        ? "التقويم الاقتصادي غير متاح — لم تُراجَع الأحداث."
        : `خطر الأحداث الاقتصادية: ${news}.`,
    ),
  );

  const visual = input.visualConfirmation ?? "not_checked";
  dimensions.push(
    dim(
      "visual_review",
      visual === "confirmed" ? "strong" : visual === "contradicted" ? "weak" : "unavailable",
      visual === "confirmed"
        ? "الصورة تؤكد البنية الرقمية."
        : visual === "contradicted"
          ? "الصورة تعارض القراءة الرقمية."
          : "لم تُراجَع لقطات الشارت في هذا التحليل.",
    ),
  );

  dimensions.push(
    dim(
      "data_quality",
      input.dataSufficient ? "strong" : "weak",
      input.dataSufficient ? "تغطية الشموع كافية للتحليل." : "تغطية الشموع دون حد التحليل الكامل.",
    ),
  );

  if (input.validityCandles != null) {
    dimensions.push(
      dim("validity", "moderate", `صلاحية الخطة ${input.validityCandles} شمعة.`, input.validityCandles),
    );
  }

  if (input.executionReadiness) {
    dimensions.push(
      dim(
        "execution_readiness",
        input.executionReadiness.ready ? "strong" : "weak",
        input.executionReadiness.reason?.trim() ||
          (input.executionReadiness.ready ? "التنفيذ جاهز تقنياً." : "التنفيذ غير جاهز تقنياً."),
      ),
    );
  } else {
    dimensions.push(dim("execution_readiness", "unavailable", "لم تُفحص جاهزية التنفيذ."));
  }

  dimensions.push(
    dim(
      "trade_mode",
      "moderate",
      input.tradeMode === "auto"
        ? "الوضع الحالي: تلقائي — تُنفَّذ التوصية عند تحقق شروطها."
        : input.tradeMode === "advisory"
          ? "الوضع الحالي: توصية بدون تنفيذ."
          : "لا حساب متصل — تحليل وتوصيات فقط.",
    ),
  );

  return { dimensions };
}

function planTypeDetail(planType: string, executionState: string): string {
  const plan =
    planType === "immediate"
      ? "خطة فورية"
      : planType === "anticipatory"
        ? "خطة استباقية (مخاطرة أعلى من الدخول بعد التأكيد)"
        : "خطة مشروطة";
  const state =
    executionState === "valid_now"
      ? "صالحة للدخول الآن"
      : executionState === "awaiting_activation"
        ? "تنتظر شرط التفعيل"
        : executionState === "expired"
          ? "انتهت صلاحيتها"
          : executionState === "invalidated"
            ? "أُبطلت"
            : "غير قابلة للتنفيذ حالياً";
  return `${plan} — ${state}.`;
}
