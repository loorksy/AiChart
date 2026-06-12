/**
 * Telegram Bot API client + message builders. Uses the platform bot token
 * (TELEGRAM_BOT_TOKEN). Degrades gracefully when not configured.
 */

import { getTelegramChatId } from "./store";
import {
  getPlatformValue,
  getPlatformValueAsync,
  refreshPlatformConfigCache,
} from "./platformConfig";

const API = "https://api.telegram.org";

export function isTelegramConfigured(): boolean {
  return Boolean(getPlatformValue("TELEGRAM_BOT_TOKEN"));
}

/** Loads DB-backed platform config then checks for a bot token. */
export async function isTelegramConfiguredAsync(): Promise<boolean> {
  await refreshPlatformConfigCache();
  return Boolean(await getPlatformValueAsync("TELEGRAM_BOT_TOKEN"));
}

/** Resolves Telegram Login Widget props from DB / env (admin panel values). */
export async function getTelegramLoginConfig(): Promise<{
  telegramConfigured: boolean;
  botUsername: string | null;
}> {
  await refreshPlatformConfigCache();
  const token = await getPlatformValueAsync("TELEGRAM_BOT_TOKEN");
  if (!token) {
    return { telegramConfigured: false, botUsername: null };
  }

  const configuredUsername = await getPlatformValueAsync(
    "TELEGRAM_BOT_USERNAME",
  );
  if (configuredUsername) {
    return { telegramConfigured: true, botUsername: configuredUsername };
  }
  if (cachedUsername) {
    return { telegramConfigured: true, botUsername: cachedUsername };
  }

  try {
    const res = await fetch(`${API}/bot${token}/getMe`, { cache: "no-store" });
    const data = (await res.json()) as {
      ok: boolean;
      result?: { username: string };
    };
    if (data.ok && data.result?.username) {
      cachedUsername = data.result.username;
      return { telegramConfigured: true, botUsername: cachedUsername };
    }
  } catch {
    /* fall through */
  }

  return { telegramConfigured: true, botUsername: null };
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

export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

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
): Promise<number> {
  const result = (await call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  })) as { message_id: number };
  return result.message_id;
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

export async function sendPhotoBuffer(
  chatId: string | number,
  buffer: Buffer,
  caption?: string,
  buttons?: InlineButton[][],
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(
    "photo",
    new Blob([new Uint8Array(buffer)], { type: "image/png" }),
    "chart.png",
  );
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  if (buttons) {
    form.append(
      "reply_markup",
      JSON.stringify({ inline_keyboard: buttons }),
    );
  }

  const res = await fetch(`${API}/bot${token()}/sendPhoto`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok: boolean;
    description?: string;
  };
  if (!data.ok) {
    throw new Error(data.description || "Telegram sendPhoto failed");
  }
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

/** Sends PNG bytes directly (avoids long QuickChart URLs). */
export async function notifyUserPhotoBuffer(
  userId: number,
  buffer: Buffer,
  caption?: string,
  buttons?: InlineButton[][],
): Promise<void> {
  if (!isTelegramConfigured()) return;
  const chatId = await getTelegramChatId(userId);
  if (!chatId) return;
  try {
    await sendPhotoBuffer(chatId, buffer, caption, buttons);
  } catch (e) {
    console.error("[telegram] photo buffer notify failed", e);
    if (caption) await notifyUser(userId, caption, buttons);
  }
}

export async function sendVoice(
  chatId: string | number,
  buffer: Buffer,
  caption?: string,
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(
    "voice",
    new Blob([new Uint8Array(buffer)], { type: "audio/ogg" }),
    "voice.ogg",
  );
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }

  const res = await fetch(`${API}/bot${token()}/sendVoice`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok: boolean;
    description?: string;
  };
  if (!data.ok) {
    throw new Error(data.description || "Telegram sendVoice failed");
  }
}

/** Sends synthesized voice clip to a linked user. */
export async function notifyUserVoice(
  userId: number,
  buffer: Buffer,
  caption?: string,
): Promise<void> {
  if (!isTelegramConfigured()) return;
  const chatId = await getTelegramChatId(userId);
  if (!chatId) return;
  try {
    await sendVoice(chatId, buffer, caption);
  } catch (e) {
    console.error("[telegram] voice notify failed", e);
    if (caption) await notifyUser(userId, caption);
  }
}

let cachedUsername: string | null = null;
export async function getBotUsername(): Promise<string | null> {
  const { botUsername } = await getTelegramLoginConfig();
  return botUsername;
}

/**
 * Releases the bot from web-managed webhooks so the OpenClaw gateway can own
 * the conversation (OpenClaw polls / manages its own webhook).
 */
export async function deleteWebhook(): Promise<void> {
  await call("deleteWebhook", { drop_pending_updates: false });
}

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
  pattern_name?: string | null;
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
  if (rec.pattern_name) lines.push(`النمط · Pattern: <b>${rec.pattern_name}</b>`);
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
  pattern_name?: string | null;
  timeframe?: string | null;
}): string {
  const lines = [
    `<b>🤖 توصية جديدة من الخبير</b>`,
    `<b>New recommendation from the Expert</b>`,
    ``,
    `الزوج · Pair: <b>${intent.symbol}</b>`,
    `الاتجاه · Side: <b>${sideBilingual(intent.side)}</b>`,
    `الحجم المقترح · Size: <b>${intent.notional.toFixed(2)} USDT</b>`,
    `الثقة · Confidence: <b>${intent.confidence}%</b>`,
  ];
  if (intent.timeframe) {
    lines.push(`الإطار · TF: <code>${intent.timeframe}</code>`);
  }
  if (intent.pattern_name) {
    lines.push(`النمط · Pattern: <b>${intent.pattern_name}</b>`);
  }
  if (intent.entry) lines.push(`الدخول · Entry: <code>${intent.entry}</code>`);
  if (intent.stop_loss)
    lines.push(`وقف الخسارة · Stop: <code>${intent.stop_loss}</code>`);
  if (intent.take_profit)
    lines.push(`الهدف · Target: <code>${intent.take_profit}</code>`);
  if (intent.rationale) lines.push(``, `📝 ${intent.rationale}`);
  lines.push(
    ``,
    `اضغط ✅ للموافقة أو ❌ للرفض أدناه.`,
    `Tap ✅ Approve or ❌ Reject below.`,
  );
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
