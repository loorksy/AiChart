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
  if (!data.ok) {
    // #region agent log
    const { debugSessionLog } = await import("./debugSessionLog");
    debugSessionLog({
      location: "telegram.ts:call",
      message: "telegram api error",
      hypothesisId: "E",
      data: { method, description: data.description?.slice(0, 120) },
    });
    // #endregion
    throw new Error(data.description || `Telegram error: ${method}`);
  }
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

/** Sends a message with a persistent Arabic reply keyboard (bottom panel). */
export async function sendMessageWithReplyKeyboard(
  chatId: string | number,
  text: string,
  keyboardRows: string[][],
): Promise<number> {
  const result = (await call("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: {
      keyboard: keyboardRows.map((row) => row.map((label) => ({ text: label }))),
      resize_keyboard: true,
      is_persistent: true,
    },
  })) as { message_id: number };
  return result.message_id;
}

/** Removes the reply keyboard from a chat. */
export async function removeReplyKeyboard(
  chatId: string | number,
  text?: string,
): Promise<void> {
  await call("sendMessage", {
    chat_id: chatId,
    text: text ?? " ",
    reply_markup: { remove_keyboard: true },
  });
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

/** Bilingual card for a recorded recommendation — delegates to telegramCards. */
export { recommendationCard, approvalCard } from "./telegramCards";

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
