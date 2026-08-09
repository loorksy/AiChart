import type { MarketSnapshot } from "./market";
import type { Recommendation } from "./types";

export type ChartOverlayType =
  | "entry"
  | "stop_loss"
  | "take_profit"
  | "support"
  | "resistance";

export interface ChartOverlay {
  price: number;
  type: ChartOverlayType;
  label?: string;
}

export const OVERLAY_COLORS: Record<ChartOverlayType, string> = {
  entry: "#22c55e",
  stop_loss: "#ef4444",
  take_profit: "#3b82f6",
  support: "#9ca3af",
  resistance: "#9ca3af",
};

function takeProfitOverlays(
  targets: number[],
  fallback: number | null | undefined,
): ChartOverlay[] {
  const levels =
    targets.length > 0
      ? targets.filter((t) => t > 0)
      : fallback != null && fallback > 0
        ? [fallback]
        : [];
  return levels.map((price, i) => ({
    price,
    type: "take_profit" as const,
    label: levels.length > 1 ? `هدف ${i + 1}` : "هدف ربح",
  }));
}

/** Strategy levels from a stored recommendation (no SMA overlays). */
export function overlaysFromRecommendation(
  rec: Recommendation,
  targets?: number[],
): ChartOverlay[] {
  const overlays: ChartOverlay[] = [];
  if (rec.entry != null && rec.entry > 0) {
    overlays.push({ price: rec.entry, type: "entry", label: "دخول" });
  }
  if (rec.stop_loss != null && rec.stop_loss > 0) {
    overlays.push({
      price: rec.stop_loss,
      type: "stop_loss",
      label: "وقف خسارة",
    });
  }
  overlays.push(...takeProfitOverlays(targets ?? [], rec.take_profit));
  return overlays;
}

export function overlaysFromAnalysis(
  rec: Recommendation | undefined,
  snap: MarketSnapshot,
  targets?: number[],
): ChartOverlay[] {
  const overlays: ChartOverlay[] = [];
  if (rec?.entry != null && rec.entry > 0) {
    overlays.push({ price: rec.entry, type: "entry", label: "دخول" });
  }
  if (rec?.stop_loss != null && rec.stop_loss > 0) {
    overlays.push({ price: rec.stop_loss, type: "stop_loss", label: "وقف خسارة" });
  }
  overlays.push(...takeProfitOverlays(targets ?? [], rec?.take_profit));
  if (snap.sma20 != null) {
    const type = snap.price >= snap.sma20 ? "support" : "resistance";
    overlays.push({ price: snap.sma20, type, label: "SMA20" });
  }
  if (snap.sma50 != null) {
    const type = snap.price >= snap.sma50 ? "support" : "resistance";
    overlays.push({ price: snap.sma50, type, label: "SMA50" });
  }
  return overlays;
}
