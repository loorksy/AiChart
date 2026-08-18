import { fetchOhlc } from "./ohlc/fetchOhlc";
import { barDurationSec, normalizeInterval } from "./intervals";
import type { MarketType } from "./markets/types";
import type { ChartDrawing } from "./chartDrawings";
import { colorForType } from "./chartDrawingLabels";
import type { ChartOverlay } from "./chartOverlays";
import { OVERLAY_COLORS } from "./chartOverlays";
import {
  validateChatImage,
  type ChatImagePayload,
} from "./chatImage";
import { CHART_CAPTURE_CANDLES } from "./chart/captureWindow";

export interface ChartSnapshotInput {
  symbol: string;
  interval: string;
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  patternName?: string | null;
  limit?: number;
}

interface SnapshotCandle {
  time: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Fallback QuickChart PNG uses the same window as live TradingView capture. */
export const QUICKCHART_CANDLE_LIMIT = CHART_CAPTURE_CANDLES;

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function fibLevels(high: number, low: number): number[] {
  return FIB_RATIOS.map((r) => high - (high - low) * r);
}

async function fetchCandleSeries(
  userId: number | undefined,
  symbol: string,
  interval: string,
  market: MarketType,
  limit: number,
): Promise<SnapshotCandle[] | null> {
  const sym = symbol.toUpperCase();
  const tf = normalizeInterval(interval);

  if (market === "forex") {
    try {
      const ohlc = await fetchOhlc({
        userId: userId ?? 0,
        symbol: sym,
        interval: tf,
        market: "forex",
        limit,
      });
      if (ohlc.candles.length >= 10) {
        return ohlc.candles.slice(-limit).map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
      }
    } catch {
      /* fall through */
    }
    return null;
  }

  return null;
}

const UP_COLOR = "#22c55e";
const DOWN_COLOR = "#ef4444";

function buildChartJson(
  input: ChartSnapshotInput,
  candles: SnapshotCandle[],
): Record<string, unknown> | null {
  if (candles.length < 10) return null;

  const n = candles.length;
  const last = candles[n - 1]!;
  const barMs = barDurationSec(input.interval) * 1000;
  const xAt = (barsAhead: number) => last.time + barsAhead * barMs;
  const xForPoint = (p: { time?: number; barsAhead?: number }) => {
    if (p.time != null && p.time > 0) {
      return p.time < 1e12 ? p.time * 1000 : p.time;
    }
    if (p.barsAhead != null) return xAt(p.barsAhead);
    return last.time;
  };

  const datasets: Record<string, unknown>[] = [
    {
      type: "candlestick",
      label: input.symbol,
      data: candles.map((c) => ({
        x: c.time,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
      })),
      color: { up: UP_COLOR, down: DOWN_COLOR, unchanged: "#94a3b8" },
      borderColor: { up: UP_COLOR, down: DOWN_COLOR, unchanged: "#94a3b8" },
      yAxisID: "y",
    },
  ];

  const annotations: Record<string, unknown> = {};
  let annIdx = 0;
  let xMaxExtension = last.time + barMs;

  const addHLine = (
    price: number,
    color: string,
    label: string,
    dashed = false,
  ) => {
    annotations[`l${annIdx++}`] = {
      type: "line",
      yMin: price,
      yMax: price,
      borderColor: color,
      borderWidth: label.includes("فيب") ? 1 : 2,
      borderDash: dashed ? [4, 4] : undefined,
      label: {
        display: true,
        enabled: true,
        content: label,
        position: "start",
        color: "#e2e8f0",
        backgroundColor: "rgba(10,14,23,0.7)",
        font: { size: 9 },
      },
    };
  };

  /** Shaded rectangle (target/stop areas, zones) like TradingView boxes. */
  const addBox = (
    yMin: number,
    yMax: number,
    color: string,
    opts: { xMin?: number; xMax?: number; dashed?: boolean } = {},
  ) => {
    annotations[`b${annIdx++}`] = {
      type: "box",
      yMin,
      yMax,
      xMin: opts.xMin,
      xMax: opts.xMax,
      backgroundColor: `${color}21`, // ~13% alpha fill
      borderColor: `${color}99`,
      borderWidth: 1,
      borderDash: opts.dashed ? [4, 4] : undefined,
    };
  };

  const addPathDataset = (
    drawing: ChartDrawing,
    label: string,
    dash: number[] | undefined,
  ) => {
    const points = drawing.points.map((p) => ({
      x: xForPoint(p),
      y: p.price,
    }));
    if (points.length === 0) return;
    // Anchor future-only paths to the current close so the line connects.
    if (drawing.points.every((p) => (p.barsAhead ?? 0) > 0 && !p.time)) {
      points.unshift({ x: last.time, y: last.close });
    }
    const maxX = Math.max(...points.map((p) => p.x));
    if (maxX > xMaxExtension) xMaxExtension = maxX;
    datasets.push({
      type: "line",
      label,
      data: points,
      borderColor: drawing.color ?? colorForType(drawing.type),
      borderDash: dash,
      fill: false,
      pointRadius: 2,
      borderWidth: 2,
      yAxisID: "y",
    });
  };

  // ── Strategy levels: lines + shaded target/stop boxes with R/R ──
  const overlays = input.overlays ?? [];
  for (const o of overlays) {
    addHLine(o.price, OVERLAY_COLORS[o.type], o.label ?? o.type);
  }

  const entry = overlays.find((o) => o.type === "entry")?.price ?? null;
  const stop = overlays.find((o) => o.type === "stop_loss")?.price ?? null;
  const target = overlays.find((o) => o.type === "take_profit")?.price ?? null;
  // Boxes cover the recent third of the chart and extend a few bars ahead.
  const boxStart = candles[Math.floor(n * 0.62)]!.time;
  const boxEnd = xAt(6);
  let riskReward: number | null = null;
  if (entry !== null && target !== null && target !== entry) {
    addBox(Math.min(entry, target), Math.max(entry, target), UP_COLOR, {
      xMin: boxStart,
      xMax: boxEnd,
    });
  }
  if (entry !== null && stop !== null && stop !== entry) {
    addBox(Math.min(entry, stop), Math.max(entry, stop), DOWN_COLOR, {
      xMin: boxStart,
      xMax: boxEnd,
    });
    if (target !== null) {
      riskReward = Math.abs(target - entry) / Math.abs(entry - stop);
    }
  }
  if (boxEnd > xMaxExtension) xMaxExtension = boxEnd;

  // ── Agent drawings ──
  // Semantic → renderable down-mapping. The drawing agent emits semantic
  // types (supply_zone, parallel_channel, neckline, positions…) that the
  // switch below has no case for — they were silently DROPPED from every
  // recommendation PNG. Each semantic type now collapses to the primitive
  // that renders it faithfully; unknown types still fall through harmlessly.
  const SNAPSHOT_TYPE_MAP: Record<string, ChartDrawing["type"]> = {
    supply_zone: "zone",
    demand_zone: "zone",
    decision_zone: "zone",
    retest_zone: "zone",
    range_box: "zone",
    rectangle: "zone",
    parallel_channel: "channel",
    regression_trend: "channel",
    neckline: "trend_line",
    trendline: "trend_line",
    trend: "trend_line",
    hline: "price_line",
    fibonacci: "fib_retracement",
    fibo: "fib_retracement",
  };
  const normalizedDrawings: ChartDrawing[] = (input.drawings ?? []).flatMap((d) => {
    // Positions expand into their entry/stop/target level cluster.
    if (d.type === "long_position" || d.type === "short_position") {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      const cluster: ChartDrawing[] = [];
      const push = (price: unknown, label: string, color: string) => {
        if (typeof price === "number" && Number.isFinite(price)) {
          cluster.push({
            type: "price_line",
            confidence: d.confidence,
            label,
            color,
            points: [{ time: d.points[0]?.time, price }],
          });
        }
      };
      push(meta.entry ?? d.points[0]?.price, "دخول", "#3b82f6");
      push(meta.stopLoss ?? d.points[2]?.price, "وقف خسارة", "#ef4444");
      push(meta.takeProfit ?? d.points[1]?.price, "هدف", "#22c55e");
      return cluster;
    }
    const mapped = SNAPSHOT_TYPE_MAP[d.type];
    return [mapped ? { ...d, type: mapped } : d];
  });

  for (const d of normalizedDrawings) {
    const color = d.color ?? colorForType(d.type);
    switch (d.type) {
      case "price_line":
        if (d.points[0]) addHLine(d.points[0].price, color, d.label ?? "مستوى");
        break;
      case "forecast_path":
        addPathDataset(d, d.label ?? "تنبؤ", [6, 4]);
        break;
      case "trend_line":
        addPathDataset(d, d.label ?? "اتجاه", undefined);
        break;
      case "polyline_pattern":
        // Named chart pattern traced through its anchors; forming patterns
        // arrive dashed from the geometry engine and keep that style.
        addPathDataset(
          d,
          d.label ?? "نموذج فني",
          d.style === "dashed" ? [5, 4] : undefined,
        );
        break;
      case "channel": {
        const half = Math.ceil(d.points.length / 2);
        addPathDataset(
          { ...d, points: d.points.slice(0, half) },
          d.label ? `${d.label} علوي` : "قناة علوي",
          [3, 3],
        );
        addPathDataset(
          { ...d, points: d.points.slice(half) },
          d.label ? `${d.label} سفلي` : "قناة سفلي",
          [3, 3],
        );
        break;
      }
      case "zone": {
        const top =
          (d.meta?.top as number) ??
          Math.max(...d.points.map((p) => p.price));
        const bottom =
          (d.meta?.bottom as number) ??
          Math.min(...d.points.map((p) => p.price));
        if (top > bottom) {
          addBox(bottom, top, color, { dashed: true });
          addHLine(top, color, d.label ?? "منطقة", true);
        }
        break;
      }
      case "fib_retracement": {
        const high =
          (d.meta?.high as number) ??
          Math.max(...d.points.map((p) => p.price));
        const low =
          (d.meta?.low as number) ??
          Math.min(...d.points.map((p) => p.price));
        if (high > low) {
          for (const price of fibLevels(high, low)) {
            addHLine(price, color, `فيب ${price.toFixed(0)}`, true);
          }
        }
        break;
      }
      case "baseline":
        if (d.points[0]) {
          addHLine(d.points[0].price, color, d.label ?? "خط أساس", true);
        }
        break;
      case "histogram_band":
        datasets.push({
          type: "bar",
          label: d.label ?? "زخم",
          data: d.points.map((p) => ({
            x: xForPoint({ ...p, barsAhead: Math.min(p.barsAhead ?? 0, 0) }),
            y: Math.abs(p.price),
          })),
          backgroundColor: `${color}66`,
          yAxisID: "y2",
          barPercentage: 0.6,
        });
        break;
      case "marker":
        for (const p of d.points) {
          annotations[`m${annIdx++}`] = {
            type: "point",
            xValue: xForPoint(p),
            yValue: p.price,
            backgroundColor: color,
            borderColor: "#0a0e17",
            borderWidth: 1,
            radius: 5,
          };
        }
        break;
      default:
        break;
    }
  }

  // The wordmark rides in the title: this PNG leaves the product (Telegram),
  // and the fallback renderer has no DOM to pin a logo into.
  const title = [
    "Lonora ·",
    input.symbol,
    input.interval,
    input.patternName ? `· ${input.patternName}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const fmtPrice = (p: number) =>
    p >= 1000 ? p.toFixed(0) : p >= 1 ? p.toFixed(2) : p.toPrecision(4);
  const subtitleParts: string[] = [];
  if (riskReward !== null && Number.isFinite(riskReward)) {
    subtitleParts.push(`R/R 1:${riskReward.toFixed(1)}`);
  }
  if (entry !== null) subtitleParts.push(`دخول ${fmtPrice(entry)}`);
  if (stop !== null) subtitleParts.push(`وقف ${fmtPrice(stop)}`);
  if (target !== null) subtitleParts.push(`هدف ${fmtPrice(target)}`);

  const hasY2 = (input.drawings ?? []).some((d) => d.type === "histogram_band");

  return {
    type: "candlestick",
    data: { datasets },
    options: {
      plugins: {
        title: {
          display: true,
          text: title,
          color: "#e2e8f0",
          font: { size: 14 },
        },
        ...(subtitleParts.length
          ? {
              subtitle: {
                display: true,
                text: subtitleParts.join("  ·  "),
                color: "#94a3b8",
                font: { size: 11 },
              },
            }
          : {}),
        legend: {
          display: datasets.length > 1,
          labels: { color: "#94a3b8", boxWidth: 10, font: { size: 10 } },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: "timeseries",
          max: xMaxExtension,
          ticks: { color: "#64748b", maxTicksLimit: 8, font: { size: 9 } },
          grid: { display: false },
        },
        y: {
          position: "right",
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148,163,184,0.12)" },
        },
        ...(hasY2
          ? {
              y2: {
                position: "left",
                display: false,
                grid: { display: false },
              },
            }
          : {}),
      },
    },
  };
}

async function renderChartPng(
  chart: Record<string, unknown>,
): Promise<Buffer | null> {
  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "3",
      chart,
      width: 1280,
      height: 560,
      backgroundColor: "#0a0e17",
      format: "png",
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Builds a QuickChart URL with candles, all drawing types, and strategy levels.
 */
export async function buildChartSnapshotUrl(
  input: ChartSnapshotInput,
): Promise<string | null> {
  try {
    const limit = input.limit ?? CHART_CAPTURE_CANDLES;
    const candles = await fetchCandleSeries(
      undefined,
      input.symbol,
      input.interval,
      "forex",
      limit,
    );
    if (!candles) return null;
    const chart = buildChartJson(input, candles);
    if (!chart) return null;
    const encoded = encodeURIComponent(JSON.stringify(chart));
    return `https://quickchart.io/chart?v=3&w=1280&h=560&bkg=%230a0e17&c=${encoded}`;
  } catch {
    return null;
  }
}

/** PNG bytes via QuickChart POST (reliable for Telegram multipart upload). */
export async function buildChartSnapshotBuffer(
  input: ChartSnapshotInput,
): Promise<Buffer | null> {
  try {
    const limit = input.limit ?? CHART_CAPTURE_CANDLES;
    const candles = await fetchCandleSeries(
      undefined,
      input.symbol,
      input.interval,
      "forex",
      limit,
    );
    if (!candles) return null;
    const chart = buildChartJson(input, candles);
    if (!chart) return null;
    return renderChartPng(chart);
  } catch {
    return null;
  }
}

/** Server-side chart PNG for forex candles. */
export async function buildChartSnapshotBufferForMarket(
  userId: number,
  symbol: string,
  interval: string,
  market: MarketType,
  extras: Partial<ChartSnapshotInput> = {},
): Promise<Buffer | null> {
  try {
    const limit = extras.limit ?? CHART_CAPTURE_CANDLES;
    const candles = await fetchCandleSeries(
      userId,
      symbol,
      interval,
      market,
      limit,
    );
    if (!candles) return null;
    const chart = buildChartJson(
      {
        symbol: symbol.toUpperCase(),
        interval: normalizeInterval(interval),
        ...extras,
      },
      candles,
    );
    if (!chart) return null;
    return renderChartPng(chart);
  } catch {
    return null;
  }
}

export function bufferToChatImage(buffer: Buffer): ChatImagePayload | null {
  const validated = validateChatImage("image/png", buffer.toString("base64"));
  return validated.ok ? validated.image : null;
}

export function chartImagePathForRecommendation(recId: number): string {
  return `/api/agent/chart/${recId}`;
}

/** @deprecated alias — use chartImagePathForRecommendation */
export function agentChartPathForRecommendation(recId: number): string {
  return chartImagePathForRecommendation(recId);
}
