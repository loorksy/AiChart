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

/** Strategy levels from a stored recommendation (no SMA overlays). */
export function overlaysFromRecommendation(rec: Recommendation): ChartOverlay[] {
  const overlays: ChartOverlay[] = [];
  if (rec.entry != null) {
    overlays.push({ price: rec.entry, type: "entry", label: "دخول" });
  }
  if (rec.stop_loss != null) {
    overlays.push({
      price: rec.stop_loss,
      type: "stop_loss",
      label: "وقف خسارة",
    });
  }
  if (rec.take_profit != null) {
    overlays.push({
      price: rec.take_profit,
      type: "take_profit",
      label: "هدف ربح",
    });
  }
  return overlays;
}

export function overlaysFromAnalysis(
  rec: Recommendation | undefined,
  snap: MarketSnapshot,
): ChartOverlay[] {
  const overlays: ChartOverlay[] = [];
  if (rec?.entry != null) {
    overlays.push({ price: rec.entry, type: "entry", label: "دخول" });
  }
  if (rec?.stop_loss != null) {
    overlays.push({ price: rec.stop_loss, type: "stop_loss", label: "وقف خسارة" });
  }
  if (rec?.take_profit != null) {
    overlays.push({ price: rec.take_profit, type: "take_profit", label: "هدف ربح" });
  }
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
