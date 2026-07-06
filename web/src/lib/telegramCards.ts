import { buildAccountProfile, accountFooterLines, type AccountProfile } from "./accountProfile";
import { formatSpreadAr } from "./spread";
import type { TradingSettings } from "./types";

export const CARD_SEPARATOR = "─────────────────";

const STYLE_EMOJI: Record<string, string> = {
  conservative: "🟢",
  balanced: "🟡",
  aggressive: "🔴",
};

function envLine(profile: AccountProfile, settings?: TradingSettings): string {
  const env = profile.accountType === "—" ? "—" : profile.accountType;
  const parts = [`البيئة: ${env}`];
  if (profile.hasLeverage && profile.leverage) {
    parts.push(`الرافعة: ${profile.leverage}x`);
  }
  if (profile.hasSpread && profile.spreadPips != null) {
    parts.push(`السبريد: ${formatSpreadAr({
      bid: 0,
      ask: 0,
      mid: 0,
      spreadRaw: 0,
      spreadPips: profile.spreadPips,
      spreadPct: profile.spreadPct ?? 0,
    })}`);
  }
  return parts.join(" · ");
}

export function formatCard(title: string, fields: string[], footer?: AccountProfile): string {
  const lines = [CARD_SEPARATOR, title, ...fields];
  if (footer) lines.push(...accountFooterLines(footer));
  lines.push(CARD_SEPARATOR);
  return lines.join("\n");
}

export function formatAmount(notional: number, currency = "دولار"): string {
  return `${Math.round(notional)} ${currency}`;
}

export function sessionStartCard(profile: AccountProfile): string {
  return formatCard(
    "👋 مرحباً — AiChart",
    [
      "🔹 اختر من الأزرار أو اكتب أمراً.",
      `🔹 السوق: ${profile.marketType === "forex" ? "فوركس" : "كربتو"}`,
      `🔹 ${envLine(profile)}`,
    ],
    profile,
  );
}

export function analysisCard(input: {
  symbol: string;
  side: string;
  confidence: number;
  entry?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  signals?: string[];
  notional?: number;
  style?: string;
  profile: AccountProfile;
}): string {
  const sideAr =
    input.side === "buy" ? "شراء 🟢" : input.side === "sell" ? "بيع 🔴" : "انتظار";
  const styleKey = input.style ?? "balanced";
  const fields = [
    `🔹 الاتجاه: ${sideAr} · الثقة: ${input.confidence}%`,
  ];
  if (input.entry) {
    const sl = input.stop_loss ? ` · SL: ${input.stop_loss}` : "";
    const tp = input.take_profit ? ` · TP: ${input.take_profit}` : "";
    fields.push(`🔹 الدخول: ${input.entry}${sl}${tp}`);
  }
  if (input.signals?.length) {
    fields.push(`🔹 الإشارات: ${input.signals.slice(0, 3).join(" · ")}`);
  }
  if (input.notional) {
    fields.push(`🔹 المبلغ المقترح: ${formatAmount(input.notional, input.profile.accountCurrency === "USD" ? "دولار" : input.profile.accountCurrency)}`);
  }
  fields.push(
    `🔹 الاستراتيجية: ${styleKey} ${STYLE_EMOJI[styleKey] ?? "🟡"}`,
    `🔹 ${envLine(input.profile)}`,
  );
  return formatCard(`📊 تحليل ${input.symbol}`, fields.slice(0, 8), input.profile);
}

export function approvalCard(input: {
  symbol: string;
  side: string;
  notional: number;
  confidence: number;
  entry?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  profile: AccountProfile;
  style?: string;
}): string {
  const sideAr = input.side === "buy" ? "شراء 🟢" : "بيع 🔴";
  const styleKey = input.style ?? "balanced";
  const fields = [
    `🔹 الاتجاه: ${sideAr} · الثقة: ${input.confidence}%`,
    `🔹 المبلغ: ${formatAmount(input.notional)}`,
  ];
  if (input.entry) {
    const sl = input.stop_loss ? ` · SL: ${input.stop_loss}` : "";
    const tp = input.take_profit ? ` · TP: ${input.take_profit}` : "";
    fields.push(`🔹 الدخول: ${input.entry}${sl}${tp}`);
  }
  fields.push(
    `🔹 الاستراتيجية: ${styleKey} ${STYLE_EMOJI[styleKey] ?? "🟡"}`,
    `🔹 ${envLine(input.profile)}`,
    "🔹 اضغط موافق أو رفض أدناه.",
  );
  return formatCard(`🤖 طلب صفقة ${input.symbol}`, fields, input.profile);
}

export function cancelledTradeCard(input: {
  symbol: string;
  reason: string;
  profile: AccountProfile;
}): string {
  return formatCard(
    "❌ تم إلغاء الصفقة",
    [`🔹 زوج التداول: ${input.symbol}`, `🔹 السبب: ${input.reason}`],
    input.profile,
  );
}

export function tradeResultCard(input: {
  symbol: string;
  side: string;
  qty: number;
  avg_price: number;
  pnl?: number;
  profile: AccountProfile;
}): string {
  const sideAr = input.side === "buy" ? "شراء 🟢" : "بيع 🔴";
  const fields = [
    `🔹 الاتجاه: ${sideAr}`,
    `🔹 الكمية: ${input.qty}`,
    `🔹 السعر: ${input.avg_price}`,
  ];
  if (input.pnl != null) {
    const sign = input.pnl >= 0 ? "+" : "";
    fields.push(`🔹 النتيجة: ${sign}${input.pnl.toFixed(2)} دولار`);
  }
  return formatCard(`✅ صفقة ${input.symbol}`, fields, input.profile);
}

export function balanceCard(input: {
  balance: string;
  equity?: string;
  profile: AccountProfile;
}): string {
  const fields = [`🔹 الرصيد: ${input.balance}`];
  if (input.equity) fields.push(`🔹 حقوق الملكية: ${input.equity}`);
  return formatCard("💰 المحفظة", fields, input.profile);
}

export function menuCard(profile: AccountProfile): string {
  return formatCard(
    "📋 القائمة الرئيسية",
    [
      "🔹 تحليل زوج · الرصيد · الصفقات",
      `🔹 السوق: ${profile.marketType === "forex" ? "فوركس" : "كربتو"}`,
      `🔹 ${envLine(profile)}`,
    ],
    profile,
  );
}

/** @deprecated Use analysisCard — kept for callers migrating gradually. */
export function recommendationCard(rec: {
  symbol: string;
  action: string;
  confidence: number;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  profile?: AccountProfile;
  signals?: string[];
  notional?: number;
  style?: string;
}): string {
  const profile = rec.profile ?? {
    hasLeverage: false,
    leverage: null,
    marginMode: null,
    hasSpread: false,
    spreadPips: null,
    spreadPct: null,
    marketType: "forex",
    platform: "—",
    accountLogin: null,
    accountCurrency: "USD",
    accountType: "—",
  };
  return analysisCard({
    symbol: rec.symbol,
    side: rec.action,
    confidence: rec.confidence,
    entry: rec.entry,
    stop_loss: rec.stop_loss,
    take_profit: rec.take_profit,
    signals: rec.signals,
    notional: rec.notional,
    style: rec.style,
    profile,
  });
}
