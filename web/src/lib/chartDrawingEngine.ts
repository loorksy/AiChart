import {
  LineSeries,
  AreaSeries,
  BaselineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { ChartDrawing, ChartPoint } from "./chartDrawings";
import {
  pointsToLineData,
  styleForConfidence,
} from "./chartDrawings";
import { barDurationSec } from "./intervals";
import { legendFromDrawings, type LegendItem } from "./chartDrawingLabels";

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  if (hex.startsWith("#") && hex.length === 7) return `${hex}${a}`;
  return hex;
}

function numMeta(meta: Record<string, unknown> | undefined, key: string): number | null {
  const v = meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pointArrMeta(meta: Record<string, unknown> | undefined, key: string): ChartPoint[] {
  const v = meta?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter(
    (p): p is ChartPoint =>
      typeof p === "object" &&
      p != null &&
      typeof (p as ChartPoint).price === "number",
  );
}

function fibLevels(high: number, low: number): { ratio: number; price: number }[] {
  const range = high - low;
  return FIB_RATIOS.map((ratio) => ({
    ratio,
    price: high - range * ratio,
  }));
}

function markerShape(
  label?: string,
): SeriesMarker<Time>["shape"] {
  const t = (label ?? "").toLowerCase();
  if (t.includes("قمة") || t.includes("peak") || t.includes("high")) return "arrowDown";
  if (t.includes("قاع") || t.includes("low") || t.includes("bottom")) return "arrowUp";
  if (t.includes("شراء") || t.includes("buy")) return "arrowUp";
  if (t.includes("بيع") || t.includes("sell")) return "arrowDown";
  return "circle";
}

export interface ApplyDrawingsResult {
  cleanup: () => void;
  legendItems: LegendItem[];
  drawingMarkers: SeriesMarker<Time>[];
}

/** Marker-only pass (no series) for merging with recommendation markers. */
export function collectDrawingMarkers(
  drawings: ChartDrawing[],
  lastBarTimeSec: number,
  interval: string,
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  const step = barDurationSec(interval);
  for (const d of drawings) {
    if (d.type !== "marker") continue;
    const style = styleForConfidence(d.confidence, d.type);
    const color = d.color ?? style.color;
    for (const p of d.points) {
      const shape = markerShape(d.label);
      markers.push({
        time: (p.time ?? lastBarTimeSec + p.barsAhead * step) as UTCTimestamp,
        position: shape === "arrowDown" ? "aboveBar" : "belowBar",
        color,
        shape,
        text: d.label ?? "●",
      });
    }
  }
  return markers;
}

/**
 * Applies all ChartDrawing types to a lightweight-charts instance.
 */
export function applyChartDrawings(
  chart: IChartApi,
  candleSeries: ISeriesApi<"Candlestick">,
  drawings: ChartDrawing[],
  lastBarTimeSec: number,
  interval: string,
): ApplyDrawingsResult {
  const lineSeries: ISeriesApi<"Line">[] = [];
  const areaSeries: ISeriesApi<"Area">[] = [];
  const baselineSeries: ISeriesApi<"Baseline">[] = [];
  const histogramSeries: ISeriesApi<"Histogram">[] = [];
  const priceLines: ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[] = [];
  const drawingMarkers: SeriesMarker<Time>[] = [];

  if (lastBarTimeSec <= 0) {
    return { cleanup: () => {}, legendItems: [], drawingMarkers: [] };
  }

  for (const d of drawings) {
    const style = styleForConfidence(d.confidence, d.type);
    const color = d.color ?? style.color;

    switch (d.type) {
      case "price_line": {
        const p = d.points[0];
        if (!p) break;
        priceLines.push(
          candleSeries.createPriceLine({
            price: p.price,
            color,
            lineWidth: style.lineWidth,
            lineStyle: style.lineStyle,
            axisLabelVisible: true,
            title: d.label ?? "مستوى",
          }),
        );
        break;
      }

      case "trend_line":
      case "forecast_path": {
        if (d.points.length < 2) break;
        const line = chart.addSeries(LineSeries, {
          color,
          lineWidth: style.lineWidth,
          lineStyle: style.lineStyle,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: d.type === "forecast_path",
        });
        line.setData(
          pointsToLineData(d.points, lastBarTimeSec, interval) as {
            time: UTCTimestamp;
            value: number;
          }[],
        );
        lineSeries.push(line);
        break;
      }

      case "channel": {
        const upper = pointArrMeta(d.meta, "upper").length
          ? pointArrMeta(d.meta, "upper")
          : d.points.slice(0, Math.ceil(d.points.length / 2));
        const lower = pointArrMeta(d.meta, "lower").length
          ? pointArrMeta(d.meta, "lower")
          : d.points.slice(Math.ceil(d.points.length / 2));
        for (const [pts, tone] of [
          [upper, color],
          [lower, withAlpha(color, 0.7)],
        ] as const) {
          if (pts.length < 2) continue;
          const line = chart.addSeries(LineSeries, {
            color: tone,
            lineWidth: style.lineWidth,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          line.setData(
            pointsToLineData(pts, lastBarTimeSec, interval) as {
              time: UTCTimestamp;
              value: number;
            }[],
          );
          lineSeries.push(line);
        }
        break;
      }

      case "zone": {
        const top =
          numMeta(d.meta, "top") ??
          d.points[0]?.price ??
          Math.max(...d.points.map((p) => p.price));
        const bottom =
          numMeta(d.meta, "bottom") ??
          d.points[1]?.price ??
          Math.min(...d.points.map((p) => p.price));
        const zonePoints =
          d.points.length >= 2
            ? d.points
            : [
                { barsAhead: 0, price: top },
                { barsAhead: 8, price: top },
              ];
        const topLine = chart.addSeries(AreaSeries, {
          lineColor: withAlpha(color, style.opacity),
          topColor: withAlpha(color, style.opacity * 0.35),
          bottomColor: withAlpha(color, 0.05),
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        topLine.setData(
          pointsToLineData(zonePoints, lastBarTimeSec, interval).map((pt) => ({
            time: pt.time as UTCTimestamp,
            value: top,
          })),
        );
        const baseLine = chart.addSeries(AreaSeries, {
          lineColor: withAlpha(color, style.opacity * 0.5),
          topColor: withAlpha(color, 0.02),
          bottomColor: withAlpha(color, 0.02),
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        baseLine.setData(
          pointsToLineData(zonePoints, lastBarTimeSec, interval).map((pt) => ({
            time: pt.time as UTCTimestamp,
            value: bottom,
          })),
        );
        areaSeries.push(topLine, baseLine);
        break;
      }

      case "fib_retracement": {
        const high =
          numMeta(d.meta, "high") ??
          Math.max(...d.points.map((p) => p.price), 0);
        const low =
          numMeta(d.meta, "low") ??
          Math.min(...d.points.map((p) => p.price), high);
        if (high <= low) break;
        for (const { ratio, price } of fibLevels(high, low)) {
          priceLines.push(
            candleSeries.createPriceLine({
              price,
              color: withAlpha(color, style.opacity),
              lineWidth: 1,
              lineStyle: ratio === 0 || ratio === 1 ? 0 : 2,
              axisLabelVisible: true,
              title: d.label ? `${d.label} ${(ratio * 100).toFixed(1)}%` : `${(ratio * 100).toFixed(1)}%`,
            }),
          );
        }
        break;
      }

      case "baseline": {
        const base = d.points[0]?.price;
        if (base == null) break;
        const bl = chart.addSeries(BaselineSeries, {
          baseValue: { type: "price", price: base },
          topLineColor: withAlpha(color, style.opacity),
          topFillColor1: withAlpha(color, style.opacity * 0.25),
          topFillColor2: withAlpha(color, 0.05),
          bottomLineColor: withAlpha(color, style.opacity * 0.5),
          bottomFillColor1: withAlpha("#ef4444", 0.08),
          bottomFillColor2: withAlpha("#ef4444", 0.02),
          lineWidth: style.lineWidth,
          priceLineVisible: false,
        });
        const candleData = candleSeries.data();
        if (candleData.length > 0) {
          bl.setData(
            candleData
              .filter((c): c is { time: Time; close: number } => "close" in c)
              .map((c) => ({
                time: c.time as UTCTimestamp,
                value: c.close,
              })),
          );
        }
        baselineSeries.push(bl);
        break;
      }

      case "marker": {
        const step = barDurationSec(interval);
        for (const p of d.points) {
          const t = (p.time ?? lastBarTimeSec + p.barsAhead * step) as UTCTimestamp;
          const shape = markerShape(d.label);
          drawingMarkers.push({
            time: t,
            position: shape === "arrowDown" ? "aboveBar" : "belowBar",
            color,
            shape,
            text: d.label ?? "●",
          });
        }
        break;
      }

      case "histogram_band": {
        const hist = chart.addSeries(HistogramSeries, {
          color: withAlpha(color, style.opacity * 0.6),
          priceFormat: { type: "volume" },
          priceScaleId: "histogram_band",
        });
        chart.priceScale("histogram_band").applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });
        hist.setData(
          pointsToLineData(d.points, lastBarTimeSec, interval).map((pt) => ({
            time: pt.time as UTCTimestamp,
            value: Math.abs(pt.value),
            color: withAlpha(color, style.opacity * 0.5),
          })),
        );
        histogramSeries.push(hist);
        break;
      }

      default:
        break;
    }
  }

  if (drawings.some((d) => d.type === "forecast_path" || d.type === "channel")) {
    chart.timeScale().applyOptions({ rightOffset: 14 });
  }

  return {
    legendItems: legendFromDrawings(drawings),
    drawingMarkers,
    cleanup: () => {
      for (const pl of priceLines) candleSeries.removePriceLine(pl);
      for (const s of lineSeries) chart.removeSeries(s);
      for (const s of areaSeries) chart.removeSeries(s);
      for (const s of baselineSeries) chart.removeSeries(s);
      for (const s of histogramSeries) chart.removeSeries(s);
    },
  };
}
