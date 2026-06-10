import { getKlines } from "./binance";
import { getEaCandles } from "./eaStore";
import { normalizeInterval } from "./intervals";
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

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function fibLevels(high: number, low: number): number[] {
  return FIB_RATIOS.map((r) => high - (high - low) * r);
}

async function fetchCloseSeries(
  userId: number | undefined,
  symbol: string,
  interval: string,
  market: MarketType,
  limit: number,
): Promise<number[] | null> {
  const sym = symbol.toUpperCase();
  const tf = normalizeInterval(interval);

  if (market === "forex") {
    if (!userId) return null;
    const cached = await getEaCandles(userId, sym, tf);
    if (!cached) return null;
    try {
      const rows = JSON.parse(cached.candles_json) as { close?: number }[];
      const closes = rows
        .map((r) => Number(r.close))
        .filter((c) => Number.isFinite(c));
      return closes.length >= 10 ? closes.slice(-limit) : null;
    } catch {
      return null;
    }
  }

  const candles = await getKlines(sym, tf, limit, "prod");
  if (candles.length < 10) return null;
  return candles.map((c) => Number(c.close.toFixed(4)));
}

function buildChartJson(
  input: ChartSnapshotInput,
  closeData: number[],
): Record<string, unknown> | null {
  if (closeData.length < 10) return null;

  const n = closeData.length;
  const labels = closeData.map((_, i) =>
    i % Math.max(1, Math.floor(n / 8)) === 0 ? String(i) : "",
  );
  const lastClose = closeData[n - 1]!;

  const datasets: Record<string, unknown>[] = [
    {
      label: input.symbol,
      data: closeData,
      borderColor: "#3b82f6",
      backgroundColor: "rgba(59,130,246,0.08)",
      fill: true,
      pointRadius: 0,
      borderWidth: 2,
      yAxisID: "y",
    },
  ];

  const annotations: Record<string, unknown> = {};
  let annIdx = 0;

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
        content: label,
        position: "start",
        color: "#e2e8f0",
        backgroundColor: "rgba(10,14,23,0.7)",
        font: { size: 9 },
      },
    };
  };

  const addPathDataset = (
    drawing: ChartDrawing,
    label: string,
    dash: number[] | undefined,
  ) => {
    const pathData = new Array(n).fill(null) as (number | null)[];
    pathData[n - 1] = lastClose;
    const extra = drawing.points.filter((p) => p.barsAhead > 0);
    const localLabels = [...labels];
    for (let i = 0; i < extra.length; i++) {
      pathData.push(extra[i]!.price);
      localLabels.push(`+${extra[i]!.barsAhead}`);
    }
    while (localLabels.length < pathData.length) localLabels.push("");
    datasets.push({
      label,
      data: pathData,
      borderColor: drawing.color ?? DRAWING_TYPE_COLORS[drawing.type],
      borderDash: dash,
      fill: false,
      pointRadius: 2,
      borderWidth: 2,
      yAxisID: "y",
    });
    return localLabels;
  };

  for (const o of input.overlays ?? []) {
    addHLine(o.price, OVERLAY_COLORS[o.type], o.label ?? o.type);
  }

  let extendedLabels = labels;

  for (const d of input.drawings ?? []) {
    const color = d.color ?? DRAWING_TYPE_COLORS[d.type];
    switch (d.type) {
      case "price_line":
        if (d.points[0]) addHLine(d.points[0].price, color, d.label ?? "مستوى");
        break;
      case "forecast_path":
        extendedLabels = addPathDataset(d, d.label ?? "تنبؤ", [6, 4]);
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
        addHLine(top, color, d.label ? `${d.label} أعلى` : "منطقة أعلى", true);
        addHLine(bottom, color, d.label ? `${d.label} أسفل` : "منطقة أسفل", true);
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
          data: d.points.map((p) => Math.abs(p.price)),
          backgroundColor: `${color}66`,
          yAxisID: "y2",
          barPercentage: 0.6,
        });
        break;
      case "marker":
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

  const hasY2 = (input.drawings ?? []).some((d) => d.type === "histogram_band");

  return {
    type: "line",
    data: { labels: extendedLabels, datasets },
    options: {
      plugins: {
        title: {
          display: true,
          text: title,
          color: "#e2e8f0",
          font: { size: 14 },
        },
        legend: {
          display: datasets.length > 1,
          labels: { color: "#94a3b8", boxWidth: 10, font: { size: 10 } },
        },
        annotation: { annotations },
      },
      scales: {
        x: { display: false },
        y: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148,163,184,0.12)" },
        },
        ...(hasY2
          ? {
              y2: {
                position: "right",
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
    const closeData = await fetchCloseSeries(
      undefined,
      input.symbol,
      input.interval,
      "crypto",
      limit,
    );
    if (!closeData) return null;
    const chart = buildChartJson(input, closeData);
    if (!chart) return null;
    const encoded = encodeURIComponent(JSON.stringify(chart));
    return `https://quickchart.io/chart?w=900&h=480&bkg=%230a0e17&c=${encoded}`;
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
    const closeData = await fetchCloseSeries(
      undefined,
      input.symbol,
      input.interval,
      "crypto",
      limit,
    );
    if (!closeData) return null;
    const chart = buildChartJson(input, closeData);
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
    const closeData = await fetchCloseSeries(
      userId,
      symbol,
      interval,
      market,
      limit,
    );
    if (!closeData) return null;
    const chart = buildChartJson(
      {
        symbol: symbol.toUpperCase(),
        interval: normalizeInterval(interval),
        ...extras,
      },
      closeData,
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
