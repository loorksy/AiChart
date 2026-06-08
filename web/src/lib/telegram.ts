/**
 * Telegram Bot API client + message builders. Uses the platform bot token
 * (TELEGRAM_BOT_TOKEN). Degrades gracefully when not configured.
 */

import { getTelegramChatId } from "./store";

const API = "https://api.telegram.org";

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function webhookSecret(): string {
  return process.env.TELEGRAM_WEBHOOK_SECRET || "aichart-webhook-secret";
}

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN غير مُعدّ.");
  return t;
}

async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok: boolean;
    description?: string;
    result?: unknown;
  };
  if (!data.ok) throw new Error(data.description || `Telegram error: ${method}`);
  return data.result;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

/** Best-effort notification to a user's linked Telegram (no-op if unlinked). */
export async function notifyUser(
  userId: number,
  text: string,
  buttons?: InlineButton[][],
): Promise<void> {
  if (!isTelegramConfigured()) return;
  const chatId = getTelegramChatId(userId);
  if (!chatId) return;
  try {
    await sendMessage(chatId, text, buttons);
  } catch (e) {
    console.error("[telegram] notify failed", e);
  }
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  buttons?: InlineButton[][],
): Promise<void> {
  await call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export async function answerCallback(
  callbackId: string,
  text?: string,
): Promise<void> {
  await call("answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text } : {}),
  });
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
): Promise<void> {
  await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  });
}

let cachedUsername: string | null = null;
export async function getBotUsername(): Promise<string | null> {
  if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME;
  if (cachedUsername) return cachedUsername;
  if (!isTelegramConfigured()) return null;
  try {
    const me = (await call("getMe", {})) as { username: string };
    cachedUsername = me.username;
    return me.username;
  } catch {
    return null;
  }
}

export async function setWebhook(url: string): Promise<void> {
  await call("setWebhook", {
    url,
    secret_token: webhookSecret(),
    allowed_updates: ["message", "callback_query"],
  });
}

/** Registers the bilingual (Arabic + English) command menu. */
export async function setBotCommands(): Promise<void> {
  await call("setMyCommands", {
    commands: [
      { command: "status", description: "الحالة · Account status" },
      { command: "positions", description: "الصفقات المفتوحة · Open positions" },
      { command: "pnl", description: "أرباح/خسائر اليوم · Today's PnL" },
      { command: "pause", description: "إيقاف التداول · Pause trading" },
      { command: "resume", description: "استئناف التداول · Resume trading" },
      { command: "stop", description: "إيقاف طارئ · Emergency stop" },
      { command: "help", description: "المساعدة · Help" },
    ],
  });
}

// Bilingual inline buttons reused across the bot.
export const APPROVE_BUTTON_TEXT = "✅ موافقة · Approve";
export const REJECT_BUTTON_TEXT = "❌ رفض · Reject";

const sideBilingual = (s: string) =>
  s === "buy" ? "🟢 شراء · Buy" : "🔴 بيع · Sell";

/** Builds a professional bilingual trade-approval card. */
export function approvalCard(intent: {
  symbol: string;
  side: string;
  notional: number;
  confidence: number;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  rationale: string | null;
}): string {
  const lines = [
    `<b>🤖 توصية جديدة من الخبير</b>`,
    `<b>New recommendation from the Expert</b>`,
    ``,
    `الزوج · Pair: <b>${intent.symbol}</b>`,
    `الاتجاه · Side: <b>${sideBilingual(intent.side)}</b>`,
    `الحجم · Size: <b>${intent.notional.toFixed(2)} USDT</b>`,
    `الثقة · Confidence: <b>${intent.confidence}%</b>`,
  ];
  if (intent.entry) lines.push(`الدخول · Entry: <code>${intent.entry}</code>`);
  if (intent.stop_loss)
    lines.push(`وقف الخسارة · Stop: <code>${intent.stop_loss}</code>`);
  if (intent.take_profit)
    lines.push(`الهدف · Target: <code>${intent.take_profit}</code>`);
  if (intent.rationale) lines.push(``, `📝 ${intent.rationale}`);
  lines.push(``, `هل توافق على التنفيذ؟ · Approve this trade?`);
  return lines.join("\n");
}

export function executedCard(t: {
  symbol: string;
  side: string;
  qty: number;
  avg_price: number;
  env: string;
}): string {
  return [
    `<b>✅ تم تنفيذ صفقة · Trade executed</b>`,
    ``,
    `الزوج · Pair: <b>${t.symbol}</b>`,
    `الاتجاه · Side: <b>${sideBilingual(t.side)}</b>`,
    `الكمية · Qty: <code>${t.qty}</code>`,
    `السعر · Price: <code>${t.avg_price}</code>`,
    `البيئة · Env: ${t.env === "testnet" ? "تجريبية · Testnet" : "حقيقية · Live"}`,
  ].join("\n");
}
