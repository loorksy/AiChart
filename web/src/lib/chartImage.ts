import { getKlines } from "./binance";

/**
 * Builds a chart image URL (QuickChart) from recent kline closes.
 * Used for Telegram trade screenshots when the user enables send_screenshot.
 */
export async function buildChartImageUrl(
  symbol: string,
  interval = "1h",
  limit = 60,
): Promise<string | null> {
  try {
    const candles = await getKlines(symbol.toUpperCase(), interval, limit, "prod");
    if (candles.length < 10) return null;

    const labels = candles.map((_, i) => (i % 10 === 0 ? String(i) : ""));
    const data = candles.map((c) => Number(c.close.toFixed(2)));

    const chart = {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: symbol,
            data,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,0.1)",
            fill: true,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: `${symbol} · ${interval}`,
            color: "#e2e8f0",
          },
          legend: { display: false },
        },
        scales: {
          x: { display: false },
          y: {
            ticks: { color: "#94a3b8" },
            grid: { color: "rgba(148,163,184,0.15)" },
          },
        },
      },
    };

    const encoded = encodeURIComponent(JSON.stringify(chart));
    return `https://quickchart.io/chart?w=800&h=400&bkg=%230a0e17&c=${encoded}`;
  } catch {
    return null;
  }
}
