import { buildAccountProfile, accountFooterLines, type AccountProfile } from "./accountProfile";
import { formatSpreadAr } from "./spread";
import type { LifecycleEvent, LifecycleEventType } from "./recommendations/lifecycleEvents";

export const CARD_SEPARATOR = "─────────────────";

/** Footer carried by every card — the one line that makes them read as one product. */
export const BRAND_FOOTER = "<i>Lonora</i>";

/** Escape a dynamic value for Telegram HTML parse mode. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wrap prices/levels in <code> so they stand out and copy in one tap. */
function highlightNumbers(escaped: string): string {
  return escaped.replace(/(\d+(?:\.\d+)?)/g, "<code>$1</code>");
}

function envLine(profile: AccountProfile): string {
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
  const lines = [`<b>${title}</b>`, CARD_SEPARATOR, ...fields];
  if (footer) lines.push(...accountFooterLines(footer).map((line) => `<i>${escapeHtml(line)}</i>`));
  lines.push(CARD_SEPARATOR, BRAND_FOOTER);
  return lines.join("\n");
}

/** Per-event visual identity for recommendation lifecycle notifications. */
const LIFECYCLE_EMOJI: Record<LifecycleEventType, string> = {
  opportunity_created: "🆕",
  approaching_entry: "🎯",
  activated: "⚡",
  approaching_invalidation: "⚠️",
  entry_updated: "🔄",
  scenario_changed: "🔀",
  retest_started: "🔁",
  breakout_no_retest: "🏃",
  economic_event_near: "📅",
  reevaluation_confirmed: "🔎",
  tp1_hit: "✅",
  tp2_hit: "✅",
  tp3_hit: "🏆",
  sl_hit: "🛑",
  invalidated: "❌",
  expired: "⌛",
  missed_no_fill: "🚫",
  executed_auto: "🤖",
  execution_skipped: "⏸️",
};

export function lifecycleEventEmoji(type: LifecycleEventType): string {
  return LIFECYCLE_EMOJI[type] ?? "🔔";
}

export function lifecycleEventLabel(type: LifecycleEventType): string {
  switch (type) {
    case "opportunity_created":
      return "فرصة جديدة";
    case "approaching_entry":
      return "اقتراب من الدخول";
    case "activated":
      return "تفعّلت الخطة";
    case "approaching_invalidation":
      return "اقتراب من الإبطال";
    case "entry_updated":
      return "تحديث الخطة";
    case "scenario_changed":
      return "تغيّر السيناريو";
    case "reevaluation_confirmed":
      return "تأكيد الخطة بعد إعادة التقييم";
    case "retest_started":
      return "بدأ إعادة الاختبار";
    case "breakout_no_retest":
      return "اختراق دون إعادة اختبار";
    case "economic_event_near":
      return "حدث اقتصادي وشيك";
    case "tp1_hit":
      return "تحقق الهدف الأول";
    case "tp2_hit":
      return "تحقق الهدف الثاني";
    case "tp3_hit":
      return "تحقق الهدف الثالث";
    case "sl_hit":
      return "ضُرب وقف الخسارة";
    case "invalidated":
      return "أُبطلت الخطة";
    case "expired":
      return "انتهت الصلاحية";
    case "missed_no_fill":
      return "فاتت الفرصة دون تنفيذ";
    case "executed_auto":
      return "نُفّذت آلياً";
    case "execution_skipped":
      return "امتنع التنفيذ";
    default:
      return "تحديث";
  }
}

/**
 * One professional Telegram card for a group of lifecycle events on one plan.
 *
 * Header carries the strongest event (terminal wins), each change gets its own
 * emoji-labelled line with prices in <code>, and the shared brand footer closes
 * the card so lifecycle alerts read like the rest of the product.
 */
export function lifecycleCard(
  events: ReadonlyArray<Pick<LifecycleEvent, "type" | "symbol" | "detail" | "terminal">>,
): string {
  if (!events.length) return "";
  const head = events.find((event) => event.terminal) ?? events[0]!;
  const symbol = escapeHtml(head.symbol);
  const title = `${lifecycleEventEmoji(head.type)} <b>${lifecycleEventLabel(head.type)}</b> — <b>${symbol}</b>`;
  const lines = [title, CARD_SEPARATOR];
  for (const event of events) {
    // Strip the leading "SYMBOL:" the derivation embeds — the header already names it.
    const prefix = `${event.symbol}:`;
    const detail = event.detail.startsWith(prefix)
      ? event.detail.slice(prefix.length).trim()
      : event.detail;
    lines.push(`${lifecycleEventEmoji(event.type)} ${highlightNumbers(escapeHtml(detail))}`);
  }
  lines.push(CARD_SEPARATOR, BRAND_FOOTER);
  return lines.join("\n");
}

export function formatAmount(notional: number, currency = "دولار"): string {
  return `${Math.round(notional)} ${currency}`;
}

export function sessionStartCard(profile: AccountProfile): string {
  return formatCard(
    "👋 مرحباً — Lonora",
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
  profile: AccountProfile;
}): string {
  const sideAr =
    input.side === "buy" ? "شراء 🟢" : input.side === "sell" ? "بيع 🔴" : "انتظار";
  const fields = [
    input.side === "buy" || input.side === "sell"
      ? `🔹 الاتجاه: ${sideAr} · الثقة: ${input.confidence}%`
      : `🔹 الاتجاه: ${sideAr}`,
  ];
  if (input.entry) {
    const sl = input.stop_loss ? ` · SL: ${input.stop_loss}` : "";
    const tp = input.take_profit ? ` · TP: ${input.take_profit}` : "";
    fields.push(`🔹 الدخول: ${input.entry}${sl}${tp}`);
  }
  if (input.signals?.length) {
    fields.push(`🔹 الإشارات: ${input.signals.slice(0, 3).join(" · ")}`);
  }
  fields.push(
    "🔹 الأسلوب: Scalping",
    `🔹 ${envLine(input.profile)}`,
  );
  return formatCard(`📊 تحليل ${input.symbol}`, fields.slice(0, 8), input.profile);
}

export function approvalCard(input: {
  symbol: string;
  side: string;
  riskAmount: number;
  confidence: number;
  entry?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  profile: AccountProfile;
}): string {
  const sideAr = input.side === "buy" ? "شراء 🟢" : "بيع 🔴";
  const fields = [
    `🔹 الاتجاه: ${sideAr} · الثقة: ${input.confidence}%`,
    `🔹 مبلغ المخاطرة المحسوب: ${formatAmount(
      input.riskAmount,
      input.profile.accountCurrency === "USD"
        ? "دولار"
        : input.profile.accountCurrency,
    )}`,
  ];
  if (input.entry) {
    const sl = input.stop_loss ? ` · SL: ${input.stop_loss}` : "";
    const tp = input.take_profit ? ` · TP: ${input.take_profit}` : "";
    fields.push(`🔹 الدخول: ${input.entry}${sl}${tp}`);
  }
  fields.push(
    "🔹 الأسلوب: Scalping",
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
    profile,
  });
}
