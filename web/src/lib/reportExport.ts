import type { Trade } from "./types";
import type { PerformanceStats } from "./analytics";
import { formatCurrency } from "./analytics";

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const TRADE_HEADERS = [
  "ID",
  "Symbol",
  "Side",
  "Quantity",
  "Quote Qty",
  "Avg Price",
  "Status",
  "Env",
  "PnL",
  "Created",
  "Closed",
];

/** Exports a list of trades to a CSV file. */
export function exportTradesCsv(trades: Trade[], filename = "trades-report.csv") {
  const rows = trades.map((t) => [
    t.id,
    t.symbol,
    t.side,
    t.qty,
    t.quote_qty,
    t.avg_price,
    t.status,
    t.env,
    t.pnl,
    t.created_at,
    t.closed_at ?? "",
  ]);
  const csv = [TRADE_HEADERS, ...rows]
    .map((r) => r.map(csvEscape).join(","))
    .join("\n");
  downloadBlob("\uFEFF" + csv, filename, "text/csv;charset=utf-8;");
}

/**
 * Builds a printable HTML report and triggers the browser print dialog,
 * letting the user "Save as PDF". No external dependency required.
 */
export function exportReportPdf({
  stats,
  trades,
  periodLabel,
  userEmail,
}: {
  stats: PerformanceStats;
  trades: Trade[];
  periodLabel: string;
  userEmail: string;
}) {
  const generatedAt = new Date().toLocaleString("ar");
  const statRows: [string, string][] = [
    ["إجمالي العائد المحقّق", `${formatCurrency(stats.totalPnl)} USDT`],
    ["عدد الصفقات المغلقة", String(stats.closedTrades)],
    ["نسبة الفوز", `${stats.winRate.toFixed(1)}%`],
    ["صفقات رابحة / خاسرة", `${stats.winningTrades} / ${stats.losingTrades}`],
    ["متوسط ربح الصفقة", `${formatCurrency(stats.avgPnl)} USDT`],
    ["أفضل صفقة", `${formatCurrency(stats.bestTrade)} USDT`],
    ["أسوأ صفقة", `${formatCurrency(stats.worstTrade)} USDT`],
    ["أقصى تراجع", `${formatCurrency(stats.maxDrawdown)} USDT`],
    ["عامل الربح", isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"],
    ["نسبة شارب", stats.sharpeRatio.toFixed(2)],
  ];

  const statsHtml = statRows
    .map(
      ([k, v]) =>
        `<tr><td class="k">${k}</td><td class="v" dir="ltr">${v}</td></tr>`,
    )
    .join("");

  const tradesHtml = trades
    .slice(0, 200)
    .map(
      (t) => `<tr>
        <td dir="ltr">${t.symbol}</td>
        <td>${t.side === "buy" ? "شراء" : "بيع"}</td>
        <td dir="ltr">${t.qty}</td>
        <td dir="ltr">${t.avg_price}</td>
        <td dir="ltr" class="${t.pnl >= 0 ? "pos" : "neg"}">${t.pnl >= 0 ? "+" : ""}${formatCurrency(t.pnl)}</td>
        <td>${t.status === "open" ? "مفتوحة" : "مغلقة"}</td>
        <td dir="ltr">${(t.closed_at ?? t.created_at).slice(0, 16)}</td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>تقرير الأداء — AiChart</title>
<style>
  * { font-family: -apple-system, "Segoe UI", Tahoma, sans-serif; }
  body { padding: 32px; color: #1a1a1a; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #6b6560; font-size: 13px; margin: 0 0 24px; }
  h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 2px solid #B8956B; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { padding: 8px 10px; text-align: right; border-bottom: 1px solid #e0dbd2; }
  th { background: #f5f0e6; font-weight: 700; }
  .k { color: #6b6560; } .v { font-weight: 700; }
  .pos { color: #16a34a; } .neg { color: #dc2626; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>تقرير الأداء — AiChart</h1>
  <p class="muted">${userEmail} · الفترة: ${periodLabel} · صدر في ${generatedAt}</p>

  <h2>ملخص الإحصائيات</h2>
  <table>${statsHtml}</table>

  <h2>سجل الصفقات (${trades.length})</h2>
  <table>
    <thead><tr>
      <th>الرمز</th><th>الاتجاه</th><th>الكمية</th><th>السعر</th>
      <th>PnL</th><th>الحالة</th><th>الوقت</th>
    </tr></thead>
    <tbody>${tradesHtml || '<tr><td colspan="7">لا توجد صفقات</td></tr>'}</tbody>
  </table>

  <script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) {
    alert("الرجاء السماح بالنوافذ المنبثقة لتصدير PDF.");
    return;
  }
  win.document.write(html);
  win.document.close();
}
