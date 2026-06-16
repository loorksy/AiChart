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
