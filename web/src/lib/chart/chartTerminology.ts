import type { ChartDrawing, PatternTypeName, SemanticRole } from "@/lib/chartDrawings";

const BANNED_VAGUE = new Set([
  "فوق",
  "تحت",
  "above",
  "below",
  "up",
  "down",
  "شراء من هنا",
  "بيع من هنا",
  "الهدف",
  "ستوب",
  "stop",
  "target",
  "buy here",
  "sell here",
]);

const SEMANTIC_ROLE_LABELS: Record<SemanticRole, string> = {
  support: "دعم",
  resistance: "مقاومة",
  demand_zone: "منطقة طلب",
  supply_zone: "منطقة عرض",
  range: "نطاق سعري",
  trendline: "خط اتجاه",
  channel: "قناة",
  neckline: "خط العنق",
  breakout: "اختراق",
  retest: "إعادة اختبار",
  entry: "منطقة دخول",
  stop_loss: "وقف الخسارة",
  take_profit: "الهدف الأول",
  risk_reward: "عائد/مخاطرة",
  pattern: "نموذج فني",
  forecast: "مسار متوقع",
  liquidity_sweep: "منطقة سيولة",
  decision_zone: "منطقة قرار",
};

export const PATTERN_TYPE_LABELS: Record<PatternTypeName, string> = {
  double_bottom: "قاع مزدوج",
  double_top: "قمة مزدوجة",
  w_pattern: "نموذج W",
  m_pattern: "نموذج M",
  head_and_shoulders: "رأس وكتفين",
  inverse_head_and_shoulders: "رأس وكتفين معكوس",
  ascending_triangle: "مثلث صاعد",
  descending_triangle: "مثلث هابط",
  symmetrical_triangle: "مثلث متماثل",
  cup_and_handle: "فنجان وعروة",
  flag: "علم",
  pennant: "راية",
  wedge: "وتد",
  channel: "قناة",
  range: "نطاق",
};

const TYPE_FALLBACK: Partial<Record<string, string>> = {
  polyline_pattern: "نموذج فني",
  range_box: "نطاق سعري",
  zone: "منطقة قرار",
  decision_zone: "منطقة قرار",
  neckline: "خط العنق",
  breakout_arrow: "اختراق",
  labeled_arrow: "سيناريو متوقع",
  risk_reward_box: "عائد/مخاطرة",
  forecast_path: "مسار متوقع",
  trend_line: "خط اتجاه",
  channel: "قناة",
  triangle: "نموذج فني",
  price_line: "مستوى محوري",
};

function isBanned(label: string): boolean {
  const t = label.trim().toLowerCase();
  if (BANNED_VAGUE.has(t)) return true;
  if (t.length < 2) return true;
  return false;
}

/** Pattern-state suffixes the geometry engine appends — must survive
 *  normalization so the operator can tell a forming shape from a completed one. */
const PATTERN_STATUS_SUFFIXES = ["(قيد التكوّن)", "(مكتمل)", "(مُبطل)"];

export function normalizeChartLabel(
  inputLabel: string | undefined,
  semanticRole?: SemanticRole,
  patternType?: PatternTypeName,
  _locale = "ar",
): string {
  if (patternType && PATTERN_TYPE_LABELS[patternType]) {
    const base = PATTERN_TYPE_LABELS[patternType];
    const suffix = PATTERN_STATUS_SUFFIXES.find((s) => inputLabel?.includes(s));
    return suffix ? `${base} ${suffix}` : base;
  }
  if (semanticRole && SEMANTIC_ROLE_LABELS[semanticRole]) {
    const fromRole = SEMANTIC_ROLE_LABELS[semanticRole];
    if (!inputLabel || isBanned(inputLabel)) return fromRole;
  }
  const raw = (inputLabel ?? "").trim();
  if (!raw || isBanned(raw)) {
    if (semanticRole && SEMANTIC_ROLE_LABELS[semanticRole]) {
      return SEMANTIC_ROLE_LABELS[semanticRole];
    }
    return "مستوى محوري";
  }
  const lower = raw.toLowerCase();
  if (lower === "neckline" || lower === "خط العنق") return "خط العنق";
  if (lower === "breakout" || lower === "اختراق") return "اختراق";
  if (lower === "retest" || lower === "إعادة اختبار") return "إعادة اختبار";
  if (lower.includes("stop") || lower.includes("ستوب")) return "وقف الخسارة";
  if (raw.length > 28) return raw.slice(0, 28).trim() + "…";
  return raw;
}

export function labelForDrawing(d: ChartDrawing): string {
  const fromType = TYPE_FALLBACK[d.type];
  return normalizeChartLabel(
    d.label ?? fromType,
    d.semanticRole,
    d.patternType,
  );
}

export function sanitizeDrawingLabels(drawings: ChartDrawing[]): ChartDrawing[] {
  return drawings.map((d) => ({
    ...d,
    label: labelForDrawing(d),
  }));
}

export const BANNED_GENERIC_LOG_PHRASES = [
  "تم تحليل الشارت بنجاح",
  "بناءً على التحليل الفني",
  "المؤشرات تشير إلى فرصة",
  "السوق جيد",
  "الرؤية العامة",
  "البنية السوقية:",
  "الخطة:",
  "النموذج:",
];

export function isGenericLogPhrase(text: string): boolean {
  const t = text.trim();
  return BANNED_GENERIC_LOG_PHRASES.some(
    (p) => t.includes(p) || t.startsWith(p),
  );
}
