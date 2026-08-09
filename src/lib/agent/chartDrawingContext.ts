import type { ChartDrawing } from "@/lib/chartDrawings";
import { drawingOwner } from "./drawings/drawingOwnership";

export interface DrawingContextItem {
  index: number;
  owner: "user" | "agent" | "system";
  type: string;
  role: string | null;
  label: string | null;
  prices: number[];
  low: number | null;
  high: number | null;
  distanceFromPrice: number | null;
}

function finitePrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function drawingPrices(d: ChartDrawing): number[] {
  const prices: number[] = [];
  for (const p of d.points ?? []) {
    const price = finitePrice(p.price);
    if (price != null) prices.push(price);
  }
  for (const value of [d.price, d.price2, d.price3]) {
    const price = finitePrice(value);
    if (price != null) prices.push(price);
  }
  return [...new Set(prices.map((p) => Number(p.toFixed(6))))];
}

export function summarizeChartDrawings(
  drawings: ChartDrawing[] | null | undefined,
  currentPrice?: number | null,
): DrawingContextItem[] {
  return (drawings ?? [])
    .map((d, index): DrawingContextItem | null => {
      const prices = drawingPrices(d);
      if (!prices.length) return null;
      const low = Math.min(...prices);
      const high = Math.max(...prices);
      const mid = (low + high) / 2;
      return {
        index: index + 1,
        owner: drawingOwner(d),
        type: d.type,
        role: d.semanticRole ?? null,
        label: d.label ?? null,
        prices,
        low,
        high,
        distanceFromPrice:
          typeof currentPrice === "number" && currentPrice > 0
            ? Number(Math.abs(currentPrice - mid).toFixed(6))
            : null,
      };
    })
    .filter((d): d is DrawingContextItem => Boolean(d))
    .slice(0, 30);
}

export function hasMeaningfulChartDrawings(
  drawings: ChartDrawing[] | null | undefined,
): boolean {
  return summarizeChartDrawings(drawings).length > 0;
}
