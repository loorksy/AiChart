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
import { PATTERN_TYPE_LABELS } from "@/lib/chart/chartTerminology";
import { t } from "@/lib/i18n";

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
  /** FRED macro regime, when collected — the card shows the trend words. */
  macroRegime?: {
    policyRatePct: number;
    policyTrend: "rising" | "falling" | "holding";
    inflationYoYPct: number | null;
    curveSpreadPct: number | null;
  } | null;
  /** Weekly COT positioning per relevant currency, when collected. */
  cotPositioning?: {
    currency: string;
    extremity: "extreme_long" | "extreme_short" | "neutral" | "unknown";
  }[] | null;
  /** Whether coverage met the trade gate. */
  dataSufficient: boolean;
  /** Visual review outcome when charts were actually read. */
  visualConfirmation?: "confirmed" | "contradicted" | "not_checked";
  /** Frames the model was actually shown — named on the visual_review row. */
  visualTimeframes?: string[];
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
    const pattern = humanPatternState(input.patternState);
    dimensions.push(
      dim(
        "pattern_state",
        completion == null ? "moderate" : completion >= 0.8 ? "strong" : "moderate",
        completion == null
          ? `النموذج: ${pattern}.`
          : `النموذج: ${pattern} (اكتمال ≈${Math.round(completion * 100)}%).`,
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
        : // The level in words, never the raw enum — "medium" inside an
          // Arabic sentence is a leak, not a grade.
          `خطر الأحداث الاقتصادية: ${t("ar", `news.level.${news}`)}.`,
    ),
  );

  // Macro regime (FRED). Context weight only — the trend words are the read;
  // the model saw the full numbers in its own bundle entry.
  if (input.macroRegime) {
    const m = input.macroRegime;
    dimensions.push(
      dim(
        "macro_regime",
        "moderate",
        `سياسة الفيدرالي ${m.policyRatePct}% (${
          m.policyTrend === "rising" ? "ترتفع" : m.policyTrend === "falling" ? "تنخفض" : "ثابتة"
        })${m.inflationYoYPct != null ? ` — التضخم السنوي ${m.inflationYoYPct}%` : ""}${
          m.curveSpreadPct != null ? ` — ميل المنحنى ${m.curveSpreadPct}` : ""
        }.`,
      ),
    );
  } else {
    dimensions.push(
      dim("macro_regime", "unavailable", "بيانات الماكرو (الفيدرالي/التضخم) غير متاحة — لم تُراجَع."),
    );
  }

  // COT positioning. Extremes get a weaker grade on purpose: a crowded trade
  // is a WARNING about continuation, not a stronger case for it. An "unknown"
  // extremity (history too short to place the net) is NOT an extreme and is
  // never described as "within its usual range" — limited history is said
  // plainly, per the absence-is-absence rule.
  if (input.cotPositioning?.length) {
    const extreme = input.cotPositioning.find(
      (c) => c.extremity === "extreme_long" || c.extremity === "extreme_short",
    );
    const anyUnknown = input.cotPositioning.some((c) => c.extremity === "unknown");
    dimensions.push(
      dim(
        "cot_positioning",
        extreme ? "weak" : "moderate",
        extreme
          ? `تموضع المضاربين على ${extreme.currency} عند طرف تاريخي (${
              extreme.extremity === "extreme_long" ? "شراء مكتظ" : "بيع مكتظ"
            }) — احتمال انعكاس أعلى.`
          : anyUnknown
            ? `تموضع المضاربين الأسبوعي متاح (${input.cotPositioning
                .map((c) => c.currency)
                .join("، ")}) والتاريخ المقارن أقصر من أن يقيس التطرف.`
            : `تموضع المضاربين الأسبوعي ضمن نطاقه المعتاد (${input.cotPositioning
                .map((c) => c.currency)
                .join("، ")}).`,
      ),
    );
  } else {
    dimensions.push(
      dim("cot_positioning", "unavailable", "تقرير مراكز المتداولين COT غير متاح — لم يُراجَع."),
    );
  }

  dimensions.push(
    visualReviewDimension(
      input.visualConfirmation ?? "not_checked",
      input.visualTimeframes ?? [],
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

/**
 * The synthesizer's pattern string carries the detector's own enums
 * ("ascending_triangle · forming"); the card is operator-facing, so the
 * vocabulary is translated here — pattern names through the chart
 * terminology map, stage words through the language map — and any enum
 * neither map knows at least loses its underscores rather than printing raw.
 */
function humanPatternState(state: string): string {
  let out = state;
  for (const [key, label] of Object.entries(PATTERN_TYPE_LABELS)) {
    out = out.split(key).join(label);
  }
  return out
    .replace(/\b(forming|completed|confirmed|invalidated)\b/g, (word) =>
      t("ar", `pattern.stage.${word}`),
    )
    .replace(/_/g, " ");
}

/**
 * The visual_review row — same state the transparency line uses.
 * Confirmed never grades `unavailable` and never says the charts were not
 * reviewed; not_checked never claims a review.
 */
export function visualReviewDimension(
  visualConfirmation: "confirmed" | "contradicted" | "not_checked",
  timeframes: readonly string[] = [],
): EvidenceDimension {
  const frames = timeframes.filter(Boolean).join(t("ar", "list.separator"));
  if (visualConfirmation === "confirmed") {
    return dim(
      "visual_review",
      "strong",
      frames
        ? t("ar", "visual.dimension.reviewed_frames", { frames })
        : t("ar", "visual.dimension.reviewed"),
    );
  }
  if (visualConfirmation === "contradicted") {
    return dim("visual_review", "weak", t("ar", "visual.dimension.contradicted"));
  }
  return dim("visual_review", "unavailable", t("ar", "visual.dimension.not_reviewed"));
}

/** Overlay the canonical visual-review row onto an existing card. */
export function applyVisualReviewDimension(
  dimensions: EvidenceDimension[],
  visual: {
    state: "confirmed" | "contradicted" | "not_checked";
    timeframes: readonly string[];
  },
): EvidenceDimension[] {
  const next = visualReviewDimension(visual.state, visual.timeframes);
  const idx = dimensions.findIndex((d) => d.key === "visual_review");
  if (idx < 0) return [...dimensions, next];
  return [...dimensions.slice(0, idx), next, ...dimensions.slice(idx + 1)];
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
