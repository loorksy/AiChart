import { getKlines } from "./binance";
import { getEaCandles } from "./eaStore";
import { getForexBackend } from "./brokers/forexBackend";
import { mt5Rates } from "./mt5local/client";
import { barDurationSec, normalizeInterval } from "./intervals";
import type { MarketType } from "./markets/types";
import type { ChartDrawing } from "./chartDrawings";
import { DRAWING_TYPE_COLORS } from "./chartDrawingLabels";
import type { ChartOverlay } from "./chartOverlays";
import { OVERLAY_COLORS } from "./chartOverlays";
import {
  validateChatImage,
  type ChatImagePayload,
} from "./chatImage";

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

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function fibLevels(high: number, low: number): number[] {
  return FIB_RATIOS.map((r) => high - (high - low) * r);
}

function num(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/** Parses EA-pushed candle rows defensively ({time,open,high,low,close} or short keys). */
function parseEaCandleRows(
  raw: string,
  interval: string,
  limit: number,
): SnapshotCandle[] | null {
  try {
    const rows = JSON.parse(raw) as Record<string, unknown>[];
    if (!Array.isArray(rows)) return null;
    const barMs = barDurationSec(interval) * 1000;
    const out: SnapshotCandle[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const close = num(r.close) ?? num(r.c);
      if (close === null) continue;
      const open = num(r.open) ?? num(r.o) ?? close;
      const high = num(r.high) ?? num(r.h) ?? Math.max(open, close);
      const low = num(r.low) ?? num(r.l) ?? Math.min(open, close);
      const t = num(r.time) ?? num(r.t);
      // EA times may be seconds; missing times fall back to a synthetic series.
      const time =
        t !== null ? (t > 1e12 ? t : t * 1000) : Date.now() - (rows.length - i) * barMs;
      out.push({ time, open, high, low, close });
    }
    return out.length >= 10 ? out.slice(-limit) : null;
  } catch {
    return null;
  }
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
    if (getForexBackend() === "mt5local") {
      try {
        const bars = await mt5Rates(sym, tf, limit);
        return bars.length >= 10
          ? bars.map((b) => ({
              time: b.time,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
            }))
          : null;
      } catch {
        return null;
      }
    }
    if (!userId) return null;
    const cached = await getEaCandles(userId, sym, tf);
    if (!cached) return null;
    return parseEaCandleRows(cached.candles_json, tf, limit);
  }

  const candles = await getKlines(sym, tf, limit, "prod");
  if (candles.length < 10) return null;
  return candles.map((c) => ({
    time: c.openTime,
    open: Number(c.open.toFixed(6)),
    high: Number(c.high.toFixed(6)),
    low: Number(c.low.toFixed(6)),
    close: Number(c.close.toFixed(6)),
  }));
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
      x: xAt(p.barsAhead),
      y: p.price,
    }));
    if (points.length === 0) return;
    // Anchor future-only paths to the current close so the line connects.
    if (drawing.points.every((p) => p.barsAhead > 0)) {
      points.unshift({ x: last.time, y: last.close });
    }
    const maxX = Math.max(...points.map((p) => p.x));
    if (maxX > xMaxExtension) xMaxExtension = maxX;
    datasets.push({
      type: "line",
      label,
      data: points,
      borderColor: drawing.color ?? DRAWING_TYPE_COLORS[drawing.type],
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
  for (const d of input.drawings ?? []) {
    const color = d.color ?? DRAWING_TYPE_COLORS[d.type];
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
            x: xAt(Math.min(p.barsAhead, 0)),
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
            xValue: xAt(p.barsAhead),
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

  const title = [
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
      width: 900,
      height: 480,
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
    const limit = input.limit ?? 80;
    const candles = await fetchCandleSeries(
      undefined,
      input.symbol,
      input.interval,
      "crypto",
      limit,
    );
    if (!candles) return null;
    const chart = buildChartJson(input, candles);
    if (!chart) return null;
    const encoded = encodeURIComponent(JSON.stringify(chart));
    return `https://quickchart.io/chart?v=3&w=900&h=480&bkg=%230a0e17&c=${encoded}`;
  } catch {
    return null;
  }
}

/** PNG bytes via QuickChart POST (reliable for Telegram multipart upload). */
export async function buildChartSnapshotBuffer(
  input: ChartSnapshotInput,
): Promise<Buffer | null> {
  try {
    const limit = input.limit ?? 80;
    const candles = await fetchCandleSeries(
      undefined,
      input.symbol,
      input.interval,
      "crypto",
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

/** Server-side chart PNG for crypto or forex (EA candles). */
export async function buildChartSnapshotBufferForMarket(
  userId: number,
  symbol: string,
  interval: string,
  market: MarketType,
  extras: Partial<ChartSnapshotInput> = {},
): Promise<Buffer | null> {
  try {
    const limit = extras.limit ?? 80;
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
  return `/api/chart-image/${recId}`;
}
