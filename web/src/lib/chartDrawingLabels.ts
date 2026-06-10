import type { DrawingType } from "./chartDrawings";

export const DRAWING_TYPE_LABELS: Record<DrawingType, string> = {
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

export const DRAWING_TYPE_COLORS: Record<DrawingType, string> = {
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
      label: d.label ?? DRAWING_TYPE_LABELS[d.type],
      color: DRAWING_TYPE_COLORS[d.type],
    });
  }
  return items;
}
