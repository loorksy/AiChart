import type { TradeIntent } from "./types";
import type { OpportunityCheck } from "./opportunityCheck";

export const ANALYZE_COST_HINT = 3;

export function amountKeyboard(intentId: number, amounts: number[]) {
  const rows: { text: string; callback_data: string }[][] = [];
  const chunk: { text: string; callback_data: string }[] = [];
  for (const n of amounts) {
    chunk.push({
      text: `${n.toFixed(0)} USDT`,
      callback_data: `amount:${intentId}:${n.toFixed(2)}`,
    });
    if (chunk.length === 2) {
      rows.push([...chunk]);
      chunk.length = 0;
    }
  }
  if (chunk.length) rows.push(chunk);
  rows.push([
    {
      text: "مبلغ مخصص",
      callback_data: `amount_custom:${intentId}`,
    },
  ]);
  rows.push([
    { text: "❌ إلغاء", callback_data: `reject:${intentId}` },
  ]);
  return rows;
}

export function staleOpportunityCard(
  intent: TradeIntent,
  check: OpportunityCheck,
  entryAtSend: number | null,
): string {
  const lines = [
    `<b>⏱️ تأخرت بالرد أو ذهبت الفرصة</b>`,
    ``,
    `الزوج · <b>${intent.symbol}</b>`,
    check.messageAr,
  ];
  if (entryAtSend != null) {
    lines.push(`الدخول عند الإرسال: <code>${entryAtSend}</code>`);
  }
  if (check.livePrice > 0) {
    lines.push(`السعر الآن: <code>${check.livePrice.toFixed(2)}</code>`);
  }
  lines.push(``, `هل تريد أن أبحث عن فرصة جديدة؟`);
  return lines.join("\n");
}

export function rescanConfirmCard(symbol: string, timeframe: string): string {
  return [
    `<b>🔍 بحث عن فرصة جديدة</b>`,
    ``,
    `الزوج: <b>${symbol}</b> · الإطار: <code>${timeframe}</code>`,
    `سيُخصم <b>~${ANALYZE_COST_HINT}</b> رصيد Claude.`,
    ``,
    `هل تتابع؟`,
  ].join("\n");
}

export function amountStepCard(intent: TradeIntent): string {
  return [
    `<b>💰 اختر مبلغ التداول</b>`,
    ``,
    `${intent.symbol} · ${intent.side === "buy" ? "شراء" : "بيع"}`,
    `الحجم الافتراضي: <b>${intent.notional.toFixed(2)} USDT</b>`,
    ``,
    `اختر مبلغاً أو أدخل قيمة مخصصة:`,
  ].join("\n");
}
