import type { DrawingType, SemanticDrawingType } from "./chartDrawings";

export const DRAWING_TYPE_LABELS: Record<SemanticDrawingType, string> = {
  price_line: "مستوى سعر",
  trend_line: "خط اتجاه",
  forecast_path: "مسار تنبؤي",
  channel: "قناة",
  zone: "منطقة",
  fib_retracement: "فيبوناتشي",
  baseline: "خط أساس",
  marker: "علامة",
  histogram_band: "شريط زخم",
  polyline_pattern: "نموذج فني",
  risk_reward_box: "عائد/مخاطرة",
  neckline: "خط العنق",
  breakout_arrow: "اختراق",
  retest_zone: "إعادة اختبار",
  pattern_label: "تسمية نموذج",
  range_box: "نطاق سعري",
  supply_zone: "منطقة عرض",
  demand_zone: "منطقة طلب",
  decision_zone: "منطقة قرار",
  labeled_arrow: "سيناريو متوقع",
  long_position: "مركز شراء",
  short_position: "مركز بيع",
  parallel_channel: "قناة موازية",
  regression_trend: "اتجاه الانحدار",
};

export const MT5_DRAWING_TYPE_LABELS: Partial<Record<DrawingType, string>> = {
  hline: "خط أفقي",
  vline: "خط عمودي",
  trend: "خط اتجاه",
  trendline: "خط اتجاه",
  ray: "شعاع",
  rectangle: "مستطيل",
  triangle: "مثلث",
  ellipse: "بيضاوي",
  arrow_up: "سهم صعود",
  arrow_down: "سهم هبوط",
  fibo: "فيبوناتشي",
  fibo_fan: "مروحة فيبو",
  text: "نص",
  label: "تسمية",
};

export const DRAWING_TYPE_COLORS: Record<SemanticDrawingType, string> = {
  price_line: "#22c55e",
  trend_line: "#a78bfa",
  forecast_path: "#f59e0b",
  channel: "#38bdf8",
  zone: "#6366f1",
  fib_retracement: "#ec4899",
  baseline: "#14b8a6",
  marker: "#eab308",
  histogram_band: "#f97316",
  polyline_pattern: "#f59e0b",
  risk_reward_box: "#3b82f6",
  neckline: "#ef4444",
  breakout_arrow: "#22c55e",
  retest_zone: "#8b5cf6",
  pattern_label: "#eab308",
  range_box: "#6366f1",
  supply_zone: "#ef4444",
  demand_zone: "#22c55e",
  decision_zone: "#a78bfa",
  labeled_arrow: "#22c55e",
  long_position: "#22c55e",
  short_position: "#ef4444",
  parallel_channel: "#38bdf8",
  regression_trend: "#a78bfa",
};

export interface LegendItem {
  type: DrawingType;
  label: string;
  color: string;
}

function labelForType(type: DrawingType, custom?: string): string {
  if (custom) return custom;
  return (
    DRAWING_TYPE_LABELS[type as SemanticDrawingType] ??
    MT5_DRAWING_TYPE_LABELS[type] ??
    type
  );
}

function colorForType(type: DrawingType): string {
  return (
    DRAWING_TYPE_COLORS[type as SemanticDrawingType] ??
    "#3A86FF"
  );
}

export { colorForType };

export function legendFromDrawings(
  drawings: { type: DrawingType; label?: string }[],
): LegendItem[] {
  const seen = new Set<DrawingType>();
  const items: LegendItem[] = [];
  for (const d of drawings) {
    if (seen.has(d.type)) continue;
    seen.add(d.type);
    items.push({
      type: d.type,
      label: labelForType(d.type, d.label),
      color: colorForType(d.type),
    });
  }
  return items;
}
