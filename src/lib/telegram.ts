/**
 * Telegram Bot API client + message builders. Uses the platform bot token
 * (TELEGRAM_BOT_TOKEN). Degrades gracefully when not configured.
 */

import dns from "node:dns";
import { getPublicAppUrl } from "./appUrl";
import { createLogger } from "./logger";
import { splitTelegramMessage } from "./telegram/html";
import { arabicBotCommands } from "./telegramCommands";
import {
  getPlatformValue,
  getPlatformValueAsync,
  refreshPlatformConfigCache,
} from "./platformConfig";

// api.telegram.org publishes AAAA records that this VPS cannot reach;
// without IPv4-first, getMe/setWebhook/sendMessage time out and the bot
// looks dead even when the token is valid.
dns.setDefaultResultOrder("ipv4first");

const log = createLogger("telegram");

const API = "https://api.telegram.org";

/**
 * Telegram deep links are `t.me/<username>` — a pasted leading @ becomes
 * `t.me/@bot` and every consumer (login widget, link card, start payload)
 * breaks. Always strip before returning a username to a caller.
 */
export function normalizeBotUsername(
  raw: string | null | undefined,
): string | null {
  const cleaned = raw?.trim().replace(/^@+/, "") ?? "";
  return cleaned.length > 0 ? cleaned : null;
}

export function isTelegramConfigured(): boolean {
  return Boolean(getPlatformValue("TELEGRAM_BOT_TOKEN")?.trim());
}

/** Loads DB-backed platform config then checks for a bot token. */
export async function isTelegramConfiguredAsync(): Promise<boolean> {
  await refreshPlatformConfigCache();
  return Boolean((await getPlatformValueAsync("TELEGRAM_BOT_TOKEN"))?.trim());
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

  const configuredUsername = normalizeBotUsername(
    await getPlatformValueAsync("TELEGRAM_BOT_USERNAME"),
  );
  if (configuredUsername) {
    return { telegramConfigured: true, botUsername: configuredUsername };
  }
  if (cachedUsername) {
    return {
      telegramConfigured: true,
      botUsername: normalizeBotUsername(cachedUsername),
    };
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
  return callOnce(method, body, true);
}

/**
 * One Bot API request, with exactly one retry on 429.
 *
 * Telegram rate-limits per chat (~1 edit/sec) and answers 429 with
 * `parameters.retry_after` seconds. The live-progress reporter throttles
 * itself well under the limit, but a burst (final answer + buttons + photo)
 * can still trip it — honoring retry_after once turns a dropped message into
 * a slightly late one. Capped at 15s so a hostile retry_after cannot pin the
 * webhook handler; a second 429 propagates like any other failure.
 */
async function callOnce(
  method: string,
  body: Record<string, unknown>,
  allowRetry: boolean,
): Promise<unknown> {
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
    parameters?: { retry_after?: number };
  };
  if (!data.ok && res.status === 429 && allowRetry) {
    const waitSec = Math.min(Math.max(data.parameters?.retry_after ?? 1, 1), 15);
    await new Promise((resolve) => setTimeout(resolve, waitSec * 1_000));
    return callOnce(method, body, false);
  }
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

export async function sendMessage(
  chatId: string | number,
  text: string,
  buttons?: InlineButton[][],
  opts?: { replyToMessageId?: number },
): Promise<number> {
  // Telegram caps text at 4096; a longer answer 400s the whole send. Chunks
  // go sequentially, buttons attach to the LAST chunk (they belong to the
  // answer's end, and duplicating them per chunk would double every option),
  // and the returned id is the last message — the one the buttons live on.
  const chunks = splitTelegramMessage(text);
  let messageId = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const last = index === chunks.length - 1;
    const result = (await call("sendMessage", {
      chat_id: chatId,
      text: chunks[index]!,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(last && buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
      // Only the first chunk quotes the user; a chain of self-quotes is noise.
      ...(index === 0 && opts?.replyToMessageId != null
        ? { reply_to_message_id: opts.replyToMessageId }
        : {}),
    })) as { message_id: number };
    messageId = result.message_id;
  }
  return messageId;
}

export async function sendChatAction(
  chatId: string | number,
  action: "typing" | "upload_photo" = "typing",
): Promise<void> {
  await call("sendChatAction", { chat_id: chatId, action });
}

export async function deleteMessage(
  chatId: string | number,
  messageId: number,
): Promise<void> {
  await call("deleteMessage", { chat_id: chatId, message_id: messageId });
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
    parse_mode: "HTML",
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

const dismissedReplyKeyboards = new Set<string>();

/**
 * Telegram cannot attach `inline_keyboard` and `remove_keyboard` on one
 * send. A leftover persistent bar from an older deploy has to be cleared
 * with its own message — we delete that message so the user never sees it.
 */
export async function dismissPersistentKeyboardOnce(
  chatId: string | number,
): Promise<void> {
  const key = String(chatId);
  if (dismissedReplyKeyboards.has(key)) return;
  dismissedReplyKeyboards.add(key);
  try {
    const result = (await call("sendMessage", {
      chat_id: chatId,
      text: "\u2060",
      reply_markup: { remove_keyboard: true },
    })) as { message_id: number };
    await call("deleteMessage", {
      chat_id: chatId,
      message_id: result.message_id,
    }).catch(() => {});
  } catch {
    /* best-effort — inline buttons still work if the old bar stays one more turn */
  }
}

export function resetDismissedReplyKeyboards(): void {
  dismissedReplyKeyboards.clear();
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  opts?: { parseMode?: "HTML"; buttons?: InlineButton[][] | null },
): Promise<void> {
  await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    ...(opts?.parseMode ? { parse_mode: opts.parseMode } : {}),
    reply_markup: { inline_keyboard: opts?.buttons ?? [] },
  });
}

export async function editMessageCaption(
  chatId: string | number,
  messageId: number,
  caption: string,
): Promise<void> {
  await call("editMessageCaption", {
    chat_id: chatId,
    message_id: messageId,
    caption,
    // Captions are SENT with parse_mode HTML (sendPhotoBuffer); editing one
    // without it rendered the markup literally after a button tap.
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [] },
  });
}

export async function editMessageReplyMarkup(
  chatId: string | number,
  messageId: number,
): Promise<void> {
  await call("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
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
  opts?: { replyToMessageId?: number },
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
  if (opts?.replyToMessageId != null) {
    form.append("reply_to_message_id", String(opts.replyToMessageId));
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

let cachedUsername: string | null = null;
export async function getBotUsername(): Promise<string | null> {
  const { botUsername } = await getTelegramLoginConfig();
  return botUsername;
}

/**
 * Releases the bot from web-managed webhooks.
 *
 * Kept as the way to turn the inbound surface OFF — not, as it once was, the
 * permanent state of the bot. Pending updates are preserved so a temporary
 * unregister does not silently discard questions operators already asked.
 */
export async function deleteWebhook(): Promise<void> {
  await call("deleteWebhook", { drop_pending_updates: false });
}

/**
 * Point Telegram at this deployment's inbound webhook.
 *
 * The secret token is what makes the endpoint safe to expose: the URL is
 * guessable and the handler behind it runs the whole decision engine, so
 * without it anyone could spend the platform's model budget by POSTing to the
 * path. Telegram echoes the token in `X-Telegram-Bot-Api-Secret-Token` on every
 * delivery, and the route rejects anything else.
 *
 * Subscribe to `message` (the question) and `callback_query` (a tap on an
 * agent-authored option on that message). Execution controls are not a
 * subscribed concern — option tokens are opaque and never place an order.
 */
export async function setWebhook(url: string, secretToken: string): Promise<void> {
  await call("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}

/**
 * Register the inbound webhook when token + secret + public URL are present.
 * Idempotent — Telegram treats a repeat setWebhook as a no-op.
 * Called from instrumentation so a deploy cannot leave the bot deaf again.
 */
export async function ensureTelegramWebhook(): Promise<boolean> {
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    log.warn("telegram.webhook.skip_no_secret");
    return false;
  }
  if (!(await isTelegramConfiguredAsync())) {
    log.warn("telegram.webhook.skip_no_token");
    return false;
  }
  const url = `${getPublicAppUrl()}/api/telegram/webhook`;
  try {
    await setWebhook(url, secret);
    // The command menu registers alongside the webhook — one boot, one
    // truth. `arabicBotCommands()` existed for exactly this and had no
    // caller, so whatever menu users saw was registered out of band
    // (BotFather) and drifted from the JSON the classifier actually answers.
    await call("setMyCommands", { commands: arabicBotCommands() }).catch(
      (error: unknown) =>
        log.warn("telegram.commands.ensure_failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    log.info("telegram.webhook.ensured", { url });
    return true;
  } catch (error) {
    log.error("telegram.webhook.ensure_failed", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

const sideBilingual = (s: string) =>
  s === "buy" ? "🟢 شراء · Buy" : "🔴 بيع · Sell";

/** Bilingual card for a recorded recommendation — delegates to telegramCards. */

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
