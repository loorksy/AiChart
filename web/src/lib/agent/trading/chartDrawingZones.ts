import type { ChartDrawing } from "@/lib/chartDrawings";
import { drawingOwner } from "../drawings/drawingOwnership";
import type { SupplyDemandZone } from "../marketContext/detectors";

function priceList(d: ChartDrawing): number[] {
  const prices: number[] = [];
  for (const p of d.points ?? []) {
    if (Number.isFinite(p.price) && p.price > 0) prices.push(p.price);
  }
  for (const p of [d.price, d.price2, d.price3]) {
    if (Number.isFinite(p) && Number(p) > 0) prices.push(Number(p));
  }
  return prices;
}

function labelText(d: ChartDrawing): string {
  return `${d.label ?? ""} ${d.semanticRole ?? ""} ${d.type ?? ""}`.toLowerCase();
}

function inferZoneType(
  d: ChartDrawing,
  currentPrice: number,
): SupplyDemandZone["type"] | null {
  const text = labelText(d);
  if (
    d.semanticRole === "support" ||
    d.semanticRole === "demand_zone" ||
    d.type === "demand_zone" ||
    text.includes("support") ||
    text.includes("demand") ||
    text.includes("دعم") ||
    text.includes("طلب")
  ) {
    return "demand";
  }
  if (
    d.semanticRole === "resistance" ||
    d.semanticRole === "supply_zone" ||
    d.type === "supply_zone" ||
    text.includes("resistance") ||
    text.includes("supply") ||
    text.includes("مقاوم") ||
    text.includes("عرض")
  ) {
    return "supply";
  }

  const prices = priceList(d);
  if (prices.length === 1 && currentPrice > 0) {
    return prices[0]! <= currentPrice ? "demand" : "supply";
  }
  return null;
}

export function chartDrawingZones(input: {
  drawings?: ChartDrawing[] | null;
  currentPrice: number;
  atr?: number | null;
  lastCandleTime?: number | null;
}): SupplyDemandZone[] {
  const buffer = Math.max(
    input.atr && input.atr > 0 ? input.atr * 0.15 : 0,
    input.currentPrice > 20 ? 0.01 : 0.0001,
  );
  const zones: SupplyDemandZone[] = [];
  for (const d of input.drawings ?? []) {
    if (drawingOwner(d) === "agent") continue;
    const type = inferZoneType(d, input.currentPrice);
    if (!type) continue;
    const prices = priceList(d);
    if (!prices.length) continue;

    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const zone =
      Math.abs(high - low) > 0
        ? { low, high }
        : { low: Math.max(0, low - buffer), high: high + buffer };
    if (!(zone.high > zone.low)) continue;
    zones.push({
      type,
      low: zone.low,
      high: zone.high,
      time: input.lastCandleTime ?? Date.now(),
    });
  }
  return zones.slice(0, 12);
}
