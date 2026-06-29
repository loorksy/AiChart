import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { channelDrawing } from "./drawings";
import { analyzeTrendlines } from "./trendlines";

export interface ChannelAnalysis {
  present: boolean;
  direction: "up" | "down" | "flat" | null;
  upperSlope: number | null;
  lowerSlope: number | null;
  drawings: ChartDrawing[];
}

/**
 * A channel exists when the support and resistance trendlines run roughly
 * parallel (similar slope sign and magnitude).
 */
export function analyzeChannels(candles: OhlcCandle[]): ChannelAnalysis {
  const { support, resistance } = analyzeTrendlines(candles);
  if (!support || !resistance) {
    return { present: false, direction: null, upperSlope: null, lowerSlope: null, drawings: [] };
  }

  const us = resistance.slopePerBar;
  const ls = support.slopePerBar;
  const ref = Math.max(Math.abs(us), Math.abs(ls), 1e-9);
  const parallel = Math.abs(us - ls) / ref <= 0.6;
  if (!parallel) {
    return { present: false, direction: null, upperSlope: us, lowerSlope: ls, drawings: [] };
  }

  const avgSlope = (us + ls) / 2;
  const span = candles[candles.length - 1]!.close || 1;
  const direction: ChannelAnalysis["direction"] =
    avgSlope > span * 1e-4 ? "up" : avgSlope < -span * 1e-4 ? "down" : "flat";

  const drawings = [
    channelDrawing(
      [resistance.from, resistance.to],
      [support.from, support.to],
      candles.length,
      66,
      direction === "up" ? "قناة صاعدة" : direction === "down" ? "قناة هابطة" : "قناة عرضية",
    ),
  ];

  return { present: true, direction, upperSlope: us, lowerSlope: ls, drawings };
}
