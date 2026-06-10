import { getKlines } from "./binance";
import type { ChartDrawing } from "./chartDrawings";
import type { ChartOverlay } from "./chartOverlays";
import { OVERLAY_COLORS } from "./chartOverlays";

export interface ChartSnapshotInput {
  symbol: string;
  interval: string;
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  patternName?: string | null;
  limit?: number;
}

/**
 * Builds a QuickChart URL with candles, strategy levels, and forecast path.
 */
export async function buildChartSnapshotUrl(
  input: ChartSnapshotInput,
): Promise<string | null> {
  try {
    const limit = input.limit ?? 80;
    const candles = await getKlines(
      input.symbol.toUpperCase(),
      input.interval,
      limit,
      "prod",
    );
    if (candles.length < 10) return null;

    const labels = candles.map((_, i) =>
      i % Math.max(1, Math.floor(candles.length / 8)) === 0 ? String(i) : "",
    );
    const closeData = candles.map((c) => Number(c.close.toFixed(4)));

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

    const forecast = input.drawings?.find((d) => d.type === "forecast_path");
    if (forecast && forecast.points.length >= 2) {
      const lastIdx = candles.length - 1;
      const lastClose = candles[lastIdx]!.close;
      const pathData = new Array(candles.length).fill(null) as (number | null)[];
      pathData[lastIdx] = lastClose;
      const extra = forecast.points.filter((p) => p.barsAhead > 0);
      for (let i = 0; i < extra.length; i++) {
        pathData.push(extra[i]!.price);
        labels.push(`+${extra[i]!.barsAhead}`);
      }
      datasets.push({
        label: "تنبؤ",
        data: pathData,
        borderColor: "#f59e0b",
        borderDash: [6, 4],
        fill: false,
        pointRadius: 2,
        borderWidth: 2,
        yAxisID: "y",
      });
    }

    const annotations: Record<string, unknown> = {};
    let annIdx = 0;
    const addHLine = (price: number, color: string, label: string) => {
      annotations[`l${annIdx++}`] = {
        type: "line",
        yMin: price,
        yMax: price,
        borderColor: color,
        borderWidth: 2,
        borderDash: label.includes("وقف") ? [4, 4] : undefined,
        label: {
          display: true,
          content: label,
          position: "start",
          color: "#e2e8f0",
          backgroundColor: "rgba(10,14,23,0.7)",
        },
      };
    };

    for (const o of input.overlays ?? []) {
      addHLine(o.price, OVERLAY_COLORS[o.type], o.label ?? o.type);
    }
    for (const d of input.drawings ?? []) {
      if (d.type === "price_line" && d.points[0]) {
        addHLine(d.points[0].price, d.color ?? "#22c55e", d.label ?? "مستوى");
      }
    }

    const title = [
      input.symbol,
      input.interval,
      input.patternName ? `· ${input.patternName}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const chart = {
      type: "line",
      data: { labels, datasets },
      options: {
        plugins: {
          title: { display: true, text: title, color: "#e2e8f0", font: { size: 14 } },
          legend: { display: datasets.length > 1, labels: { color: "#94a3b8" } },
          annotation: { annotations },
        },
        scales: {
          x: { display: false },
          y: {
            ticks: { color: "#94a3b8" },
            grid: { color: "rgba(148,163,184,0.12)" },
          },
        },
      },
    };

    const encoded = encodeURIComponent(JSON.stringify(chart));
    return `https://quickchart.io/chart?w=900&h=480&bkg=%230a0e17&c=${encoded}`;
  } catch {
    return null;
  }
}
