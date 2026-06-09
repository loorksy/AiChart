import type { InlineButton } from "./telegram";
import type { TradingSettings } from "./types";

const SEP = "━━━━━━━━━━━━━━━━";

export const TG_CALLBACK = {
  menu: (action: string) => `menu:${action}`,
  approve: (id: number) => `approve:${id}`,
  reject: (id: number) => `reject:${id}`,
} as const;

export function isMenuCallback(data: string): boolean {
  return data.startsWith("menu:");
}

export function parseMenuAction(data: string): string | null {
  if (!isMenuCallback(data)) return null;
  return data.slice("menu:".length);
}

/** Main inline keyboard shown after most interactions. */
export function mainMenuKeyboard(): InlineButton[][] {
  return [
    [
      { text: "📊 الحالة", callback_data: TG_CALLBACK.menu("status") },
      { text: "📈 الصفقات", callback_data: TG_CALLBACK.menu("positions") },
    ],
    [
      { text: "💰 ربح اليوم", callback_data: TG_CALLBACK.menu("pnl") },
      { text: "🔄 تحديث", callback_data: TG_CALLBACK.menu("refresh") },
    ],
    [
      { text: "⏸️ إيقاف", callback_data: TG_CALLBACK.menu("pause") },
      { text: "▶️ استئناف", callback_data: TG_CALLBACK.menu("resume") },
    ],
    [{ text: "❓ المساعدة", callback_data: TG_CALLBACK.menu("help") }],
  ];
}

export function welcomeKeyboard(): InlineButton[][] {
  return [
    [{ text: "🚀 افتح لوحة التحكم", callback_data: TG_CALLBACK.menu("status") }],
    ...mainMenuKeyboard(),
  ];
}

function modeLabel(mode: string): string {
  return mode === "auto" ? "⚡ تنفيذ تلقائي" : "🎯 توصيات فقط";
}

function killLabel(on: boolean): string {
  return on ? "🔴 مفعّل" : "🟢 متوقف";
}

export function welcomeCard(linked: boolean): string {
  if (linked) {
    return [
      `<b>🤖 AiChart</b>`,
      SEP,
      `مرحباً بك في وكيل التداول الذكي.`,
      `استخدم الأزرار أدناه أو اكتب سؤالك مباشرة.`,
      SEP,
      `<i>Welcome — use the buttons below or type your question.</i>`,
    ].join("\n");
  }
  return [
    `<b>🤖 AiChart</b>`,
    SEP,
    `سجّل الدخول من الموقع عبر زر تليجرام لربط حسابك.`,
    `<a href="https://aichart.lork.cloud/login">aichart.lork.cloud/login</a>`,
    SEP,
    `<i>Log in on the website with Telegram to link your account.</i>`,
  ].join("\n");
}

export function linkedSuccessCard(): string {
  return [
    `<b>✅ تم الربط بنجاح</b>`,
    SEP,
    `ستصلك إشعارات الصفقات والتوصيات هنا.`,
    `اختر من القائمة للبدء 👇`,
  ].join("\n");
}

export function helpCard(): string {
  return [
    `<b>📖 دليل AiChart</b>`,
    SEP,
    `<b>الأزرار</b>`,
    `📊 الحالة — وضع التداول والإيقاف الطارئ`,
    `📈 الصفقات — المراكز المفتوحة`,
    `💰 ربح اليوم — أرباح/خسائر اليوم`,
    `⏸️ إيقاف / ▶️ استئناف — التحكم بالوكيل`,
    SEP,
    `<b>أوامر سريعة</b>`,
    `<code>/status</code> · <code>/positions</code> · <code>/pnl</code>`,
    `<code>/pause</code> · <code>/resume</code> · <code>/help</code>`,
    SEP,
    `💬 أرسل أي سؤال أو صورة شارت للتحليل الفوري.`,
  ].join("\n");
}

export function statusCard(
  settings: TradingSettings,
  openTrades: number,
  quota?: { used: number; limit: number },
): string {
  const lines = [
    `<b>📊 حالة الحساب</b>`,
    SEP,
    `🎯 الوضع: <b>${modeLabel(settings.mode)}</b>`,
    `🛡️ Kill Switch: <b>${killLabel(Boolean(settings.kill_switch))}</b>`,
    `📈 صفقات مفتوحة: <b>${openTrades}</b>`,
  ];
  if (quota && quota.limit > 0) {
    const left = Math.max(0, quota.limit - quota.used);
    lines.push(`💳 رصيد اليوم: <b>${left}</b> / ${quota.limit}`);
  }
  lines.push(SEP, `<i>Account status · updated just now</i>`);
  return lines.join("\n");
}

export function positionsCard(
  trades: {
    symbol: string;
    side: string;
    qty: number;
    avg_price: number;
  }[],
): string {
  if (!trades.length) {
    return [
      `<b>📈 الصفقات المفتوحة</b>`,
      SEP,
      `لا توجد صفقات مفتوحة حالياً.`,
      SEP,
      `<i>No open positions.</i>`,
    ].join("\n");
  }
  const rows = trades
    .map((t) => {
      const icon = t.side === "buy" ? "🟢" : "🔴";
      return `${icon} <b>${t.symbol}</b> · ${t.qty} @ <code>${t.avg_price}</code>`;
    })
    .join("\n");
  return [`<b>📈 الصفقات المفتوحة</b>`, SEP, rows, SEP, `<i>${trades.length} open position(s)</i>`].join(
    "\n",
  );
}

export function pnlCard(pnl: number, closedCount: number): string {
  const icon = pnl >= 0 ? "🟢" : "🔴";
  const sign = pnl >= 0 ? "+" : "";
  return [
    `<b>💰 أرباح / خسائر اليوم</b>`,
    SEP,
    `${icon} <b>${sign}${pnl.toFixed(2)} USDT</b>`,
    `📦 صفقات مغلقة: <b>${closedCount}</b>`,
    SEP,
    `<i>Today's realized PnL</i>`,
  ].join("\n");
}

export function actionResultCard(
  icon: string,
  title: string,
  detail: string,
): string {
  return [`${icon} <b>${title}</b>`, SEP, detail].join("\n");
}

export function analyzingCard(): string {
  return [
    `<b>⏳ جاري التحليل…</b>`,
    SEP,
    `الوكيل يدرس السوق والبيانات.`,
    `<i>Analyzing — please wait…</i>`,
  ].join("\n");
}

export function agentReplyCard(reply: string): string {
  const body =
    reply.length > 3500 ? `${reply.slice(0, 3497)}…` : reply;
  return [`<b>🧠 رد الوكيل</b>`, SEP, body].join("\n\n");
}

export function notLinkedCard(): string {
  return [
    `<b>⚠️ الحساب غير مربوط</b>`,
    SEP,
    `اربط حسابك من إعدادات الموقع أولاً.`,
    `<a href="https://aichart.lork.cloud/settings">الإعدادات</a>`,
  ].join("\n");
}

export function quotaExceededCard(): string {
  return [
    `<b>⚠️ انتهى الرصيد اليومي</b>`,
    SEP,
    `بلغت حصّتك من الوكيل. حاول غداً أو تواصل مع الإدارة.`,
  ].join("\n");
}
