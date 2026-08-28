/**
 * Live-chart "clear drawings" presentation.
 *
 * Agent drawings, detector overlays (support/resistance horizontals), and the
 * system P/L box are three separate layers. Emptying `drawings[]` alone cannot
 * wipe the chart: TvDrawingManager.apply() still paints a native long/short
 * position from the layout recommendation, and overlaysToDrawings() still
 * turns leftover ChartOverlay rows into price lines.
 *
 * Clearing analysis drawings hides those layers on the LIVE workspace chart
 * without deleting the recommendation record from the DB. The report/detail
 * page paints from the stored rec, not this flag.
 */
import type { ChartOverlay } from "@/lib/chartOverlays";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { keepExplicitUserDrawings } from "@/lib/agent/drawings/drawingOwnership";
import type { Recommendation } from "@/lib/types";

export interface AnalysisPresentation {
  drawings: ChartDrawing[];
  overlays: ChartOverlay[];
  drawingsCleared: boolean;
}

/** Wipe analysis drawings + level overlays. Does not touch the DB rec. */
export function clearAnalysisPresentation(
  drawings: ChartDrawing[],
): AnalysisPresentation {
  return {
    drawings: keepExplicitUserDrawings(drawings),
    overlays: [],
    drawingsCleared: true,
  };
}

/**
 * Whether the live chart should paint the system trade overlay (P/L box and
 * fallback entry/stop/TP horizontals) from the layout recommendation.
 *
 * Report/detail surfaces omit `drawingsCleared` and leave paintTradeOverlay
 * at its default (true).
 */
export function shouldPaintTradeOverlay(input: {
  drawingsCleared?: boolean | null;
  paintTradeOverlay?: boolean;
}): boolean {
  if (input.paintTradeOverlay === false) return false;
  if (input.drawingsCleared) return false;
  return true;
}

export interface LiveChartApplyArgs {
  drawings: ChartDrawing[];
  trade: { recommendation: Recommendation | null; targets?: number[] };
  opts: { paintTradeOverlay: boolean };
}

/**
 * Payload TvChart hands to TvDrawingManager.apply() on the live workspace.
 * When analysis drawings are cleared, overlays are dropped and the rec is
 * not passed through — so apply() cannot put the P/L box back.
 */
export function liveChartApplyArgs(input: {
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  recommendation?: Recommendation | null;
  targets?: number[];
  drawingsCleared?: boolean | null;
  paintTradeOverlay?: boolean;
}): LiveChartApplyArgs {
  const paint = shouldPaintTradeOverlay({
    drawingsCleared: input.drawingsCleared,
    paintTradeOverlay: input.paintTradeOverlay,
  });
  return {
    drawings: paint
      ? [...overlaysToDrawings(input.overlays), ...(input.drawings ?? [])]
      : keepExplicitUserDrawings(input.drawings ?? []),
    trade: {
      recommendation: paint ? (input.recommendation ?? null) : null,
      targets: paint ? input.targets : [],
    },
    opts: { paintTradeOverlay: paint },
  };
}

const OVERLAY_LINE_COLOR: Record<string, string> = {
  entry: "#22c55e",
  stop_loss: "#ef4444",
  take_profit: "#3b82f6",
  support: "#22c55e",
  resistance: "#ef4444",
};

/** Detector/strategy overlays → agent-style price lines for the TV adapter. */
export function overlaysToDrawings(
  overlays: ChartOverlay[] | undefined,
): ChartDrawing[] {
  return (overlays ?? [])
    .filter((o) => o.price > 0)
    .map((o) => ({
      type: "price_line" as const,
      confidence: 80,
      label: o.label,
      color: OVERLAY_LINE_COLOR[o.type] ?? "#94a3b8",
      anchorMode: "time_price" as const,
      points: [{ price: o.price }],
      price: o.price,
    }));
}
