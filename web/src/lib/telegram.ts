/**
 * Telegram Bot API client + message builders. Uses the platform bot token
 * (TELEGRAM_BOT_TOKEN). Degrades gracefully when not configured.
 */

import { getTelegramChatId } from "./store";
import { getPlatformValue } from "./platformConfig";

const API = "https://api.telegram.org";

export function isTelegramConfigured(): boolean {
  return Boolean(getPlatformValue("TELEGRAM_BOT_TOKEN"));
}

export function webhookSecret(): string {
  return getPlatformValue("TELEGRAM_WEBHOOK_SECRET") || "aichart-webhook-secret";
}

function token(): string {
  const t = getPlatformValue("TELEGRAM_BOT_TOKEN");
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
  const chatId = await getTelegramChatId(userId);
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

/** Downloads a Telegram file by file_id and returns base64 + media type. */
export async function downloadTelegramPhoto(
  fileId: string,
): Promise<{ data: string; media_type: "image/jpeg" | "image/png" | "image/webp" }> {
  const fileInfo = (await call("getFile", { file_id: fileId })) as {
    file_path: string;
  };
  const url = `${API}/file/bot${token()}/${fileInfo.file_path}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("تعذّر تنزيل الصورة من تليجرام.");
  const buffer = Buffer.from(await res.arrayBuffer());
  const lower = fileInfo.file_path.toLowerCase();
  const media_type = lower.endsWith(".png")
    ? "image/png"
    : lower.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return { data: buffer.toString("base64"), media_type };
}

export async function sendPhoto(
  chatId: string | number,
  photoUrl: string,
  caption?: string,
  buttons?: InlineButton[][],
): Promise<void> {
  await call("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    ...(caption ? { caption, parse_mode: "HTML" } : {}),
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Sends a chart screenshot with optional caption to a linked user. */
export async function notifyUserPhoto(
  userId: number,
  photoUrl: string,
  caption?: string,
  buttons?: InlineButton[][],
): Promise<void> {
  if (!isTelegramConfigured()) return;
  const chatId = await getTelegramChatId(userId);
  if (!chatId) return;
  try {
    await sendPhoto(chatId, photoUrl, caption, buttons);
  } catch (e) {
    console.error("[telegram] photo notify failed", e);
    if (caption) await notifyUser(userId, caption, buttons);
  }
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
  const configured = getPlatformValue("TELEGRAM_BOT_USERNAME");
  if (configured) return configured;
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

const sideBilingualShort = (s: string) =>
  s === "buy" ? "شراء · Buy" : s === "sell" ? "بيع · Sell" : "انتظار · Wait";

/** Bilingual card for a recorded recommendation (advisory / chart caption). */
export function recommendationCard(rec: {
  symbol: string;
  action: string;
  confidence: number;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  timeframe: string | null;
  rationale: string | null;
}): string {
  const lines = [
    `<b>📊 توصية جديدة من الخبير</b>`,
    `<b>New recommendation from the Expert</b>`,
    ``,
    `الزوج · Pair: <b>${rec.symbol}</b>`,
    `الاتجاه · Action: <b>${sideBilingualShort(rec.action)}</b>`,
    `الثقة · Confidence: <b>${rec.confidence}%</b>`,
  ];
  if (rec.timeframe) lines.push(`الإطار · TF: <code>${rec.timeframe}</code>`);
  if (rec.entry) lines.push(`الدخول · Entry: <code>${rec.entry}</code>`);
  if (rec.stop_loss)
    lines.push(`وقف الخسارة · Stop: <code>${rec.stop_loss}</code>`);
  if (rec.take_profit)
    lines.push(`الهدف · Target: <code>${rec.take_profit}</code>`);
  if (rec.rationale) lines.push(``, `📝 ${rec.rationale}`);
  return lines.join("\n");
}

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
