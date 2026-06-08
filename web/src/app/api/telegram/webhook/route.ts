import { NextRequest, NextResponse } from "next/server";
import {
  consumeLinkCode,
  setTelegramChatId,
  getUserByTelegramChatId,
  getUserByTelegramId,
  setUserTelegramId,
  getSettings,
  getLimits,
  getTodayUsage,
  updateSettings,
  countOpenTrades,
  listTrades,
  getIntent,
  updateIntentStatus,
} from "@/lib/store";
import { executeIntent } from "@/lib/execution";
import { notifyTradeResult } from "@/lib/notifyTrade";
import {
  sendMessage,
  answerCallback,
  editMessageText,
  webhookSecret,
  downloadTelegramPhoto,
} from "@/lib/telegram";
import { validateChatImage } from "@/lib/chatImage";
import { runTelegramAgentChat } from "@/lib/telegramAgent";
import { isAnthropicConfigured } from "@/lib/anthropic";

interface TgPhotoSize {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
}

interface TgUpdate {
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
    caption?: string;
    photo?: TgPhotoSize[];
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
}

const HELP = [
  "<b>أوامر AiChart · AiChart commands</b>",
  "/status — حالة حسابك · Account status",
  "/positions — الصفقات المفتوحة · Open positions",
  "/pnl — أرباح/خسائر اليوم · Today's PnL",
  "/pause — إيقاف التداول · Pause trading",
  "/resume — استئناف التداول · Resume trading",
  "/stop — إيقاف طارئ · Emergency stop",
].join("\n");

export async function POST(req: NextRequest) {
  // Verify the request actually came from Telegram.
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== webhookSecret()) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message?.photo?.length) {
      await handlePhotoMessage(
        update.message.chat.id,
        update.message.photo,
        update.message.caption?.trim(),
        update.message.from?.id,
      );
    } else if (update.message?.text) {
      await handleMessage(
        update.message.chat.id,
        update.message.text.trim(),
        update.message.from?.id,
      );
    }
  } catch (e) {
    console.error("[telegram] webhook error", e);
  }

  // Always 200 so Telegram doesn't retry indefinitely.
  return NextResponse.json({ ok: true });
}

async function handlePhotoMessage(
  chatId: number,
  photos: TgPhotoSize[],
  caption: string | undefined,
  fromId?: number,
) {
  const cid = String(chatId);
  const userId = await getUserByTelegramChatId(cid);
  if (!userId) {
    await sendMessage(
      chatId,
      "حسابك غير مربوط. اربطه من إعدادات الموقع أولاً.\n" +
        "Your account isn't linked. Link it from the website settings first.",
    );
    return;
  }

  if (!isAnthropicConfigured()) {
    await sendMessage(chatId, HELP);
    return;
  }

  const limits = await getLimits(userId);
  const used = await getTodayUsage(userId);
  if (limits.claude_quota > 0 && used >= limits.claude_quota) {
    await sendMessage(
      chatId,
      "⚠️ بلغت حصّتك اليومية من الوكيل. حاول غداً.\n" +
        "⚠️ Daily agent quota reached. Try again tomorrow.",
    );
    return;
  }

  const largest = photos[photos.length - 1]!;
  await sendMessage(chatId, "⏳ جاري تحليل الشارت… · Analyzing chart…");

  try {
    const downloaded = await downloadTelegramPhoto(largest.file_id);
    const validated = validateChatImage(downloaded.media_type, downloaded.data);
    if (!validated.ok) {
      await sendMessage(chatId, validated.error);
      return;
    }

    const result = await runTelegramAgentChat(
      userId,
      caption ?? "",
      validated.image,
    );
    if (!result.ok) {
      await sendMessage(chatId, result.error);
      return;
    }
    await sendMessage(chatId, result.reply);
  } catch (e) {
    console.error("[telegram] photo analysis", e);
    await sendMessage(
      chatId,
      "تعذّر تحليل الصورة. حاول لاحقاً. · Could not analyze the image. Try again later.",
    );
  }
}

async function handleMessage(
  chatId: number,
  text: string,
  fromId?: number,
) {
  const cid = String(chatId);

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];

    if (code && code !== "welcome") {
      const userId = await consumeLinkCode(code);
      if (userId) {
        await setTelegramChatId(userId, cid);
        if (fromId) await setUserTelegramId(userId, fromId);
        await sendMessage(
          chatId,
          "✅ تم ربط حسابك بنجاح! ستصلك إشعارات الصفقات والتوصيات هنا.\n" +
            "✅ Your account is linked! You'll receive trade alerts here.\n\n" +
            HELP,
        );
        return;
      }
      await sendMessage(
        chatId,
        "⚠️ رمز الربط غير صالح أو منتهٍ. سجّل الدخول عبر تليجرام من الموقع.\n" +
          "⚠️ Invalid or expired link code. Log in with Telegram on the website.",
      );
      return;
    }

    if (fromId) {
      const user = await getUserByTelegramId(fromId);
      if (user) {
        await setTelegramChatId(user.id, cid);
        await sendMessage(
          chatId,
          "✅ أهلاً بك في <b>AiChart</b> — حسابك مربوط.\n" +
            "✅ Welcome to <b>AiChart</b> — your account is linked.\n\n" +
            HELP,
        );
        return;
      }
    }

    await sendMessage(
      chatId,
      "أهلاً بك في <b>AiChart</b> 🤖\nسجّل الدخول من الموقع عبر زر تليجرام لربط حسابك تلقائياً.\n\n" +
        "Welcome to <b>AiChart</b> 🤖\nLog in on the website with the Telegram button to link automatically.",
    );
    return;
  }

  const userId = await getUserByTelegramChatId(cid);
  if (!userId) {
    await sendMessage(
      chatId,
      "حسابك غير مربوط. اربطه من إعدادات الموقع أولاً.\n" +
        "Your account isn't linked. Link it from the website settings first.",
    );
    return;
  }

  const cmd = text.split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case "/status": {
      const s = await getSettings(userId);
      await sendMessage(
        chatId,
        [
          "<b>📊 حالة حسابك · Account status</b>",
          `الوضع · Mode: ${s.mode === "auto" ? "تنفيذ تلقائي · Auto" : "توصيات فقط · Advisory"}`,
          `الإيقاف الطارئ · Kill switch: ${s.kill_switch ? "🔴 مفعّل · ON" : "🟢 متوقف · OFF"}`,
          `الصفقات المفتوحة · Open trades: ${await countOpenTrades(userId)}`,
        ].join("\n"),
      );
      break;
    }
    case "/positions": {
      const open = (await listTrades(userId, 50)).filter((t) => t.status === "open");
      if (!open.length) {
        await sendMessage(chatId, "لا توجد صفقات مفتوحة. · No open positions.");
        break;
      }
      await sendMessage(
        chatId,
        "<b>الصفقات المفتوحة · Open positions</b>\n" +
          open
            .map(
              (t) =>
                `• ${t.symbol} ${t.side === "buy" ? "🟢" : "🔴"} ${t.qty} @ ${t.avg_price}`,
            )
            .join("\n"),
      );
      break;
    }
    case "/pnl": {
      const trades = (await listTrades(userId, 200)).filter(
        (t) => t.status === "closed" && t.closed_at?.slice(0, 10) === new Date().toISOString().slice(0, 10),
      );
      const pnl = trades.reduce((a, t) => a + t.pnl, 0);
      await sendMessage(
        chatId,
        `<b>💰 أرباح/خسائر اليوم · Today's PnL</b>\n${pnl >= 0 ? "🟢 +" : "🔴 "}${pnl.toFixed(2)} USDT (${trades.length} صفقة مغلقة · closed)`,
      );
      break;
    }
    case "/pause":
    case "/stop": {
      await updateSettings(userId, { kill_switch: 1 });
      await sendMessage(
        chatId,
        "🔴 تم إيقاف التداول. لن يفتح الوكيل أي صفقة جديدة.\n" +
          "🔴 Trading paused. The agent won't open new trades.",
      );
      break;
    }
    case "/resume": {
      await updateSettings(userId, { kill_switch: 0 });
      await sendMessage(
        chatId,
        "🟢 تم استئناف التداول. · Trading resumed.",
      );
      break;
    }
    default: {
      if (!text.startsWith("/") && isAnthropicConfigured()) {
        const limits = await getLimits(userId);
        const used = await getTodayUsage(userId);
        if (limits.claude_quota > 0 && used >= limits.claude_quota) {
          await sendMessage(
            chatId,
            "⚠️ بلغت حصّتك اليومية من الوكيل. حاول غداً.\n" +
              "⚠️ Daily agent quota reached. Try again tomorrow.",
          );
          break;
        }
        await sendMessage(chatId, "⏳ جاري التحليل… · Analyzing…");
        try {
          const result = await runTelegramAgentChat(userId, text);
          if (!result.ok) {
            await sendMessage(chatId, result.error);
            break;
          }
          await sendMessage(chatId, result.reply);
        } catch (e) {
          console.error("[telegram] agent chat", e);
          await sendMessage(
            chatId,
            "تعذّر الرد. حاول لاحقاً. · Could not reply. Try again later.",
          );
        }
        break;
      }
      await sendMessage(chatId, HELP);
    }
  }
}

async function handleCallback(cq: NonNullable<TgUpdate["callback_query"]>) {
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  if (!chatId || !cq.data) {
    await answerCallback(cq.id);
    return;
  }
  const userId = await getUserByTelegramChatId(String(chatId));
  if (!userId) {
    await answerCallback(cq.id, "حسابك غير مربوط · Not linked");
    return;
  }

  const [action, idStr] = cq.data.split(":");
  const intentId = Number(idStr);
  const intent = await getIntent(intentId);
  if (!intent || intent.user_id !== userId) {
    await answerCallback(cq.id, "الطلب غير موجود · Not found");
    return;
  }
  if (intent.status !== "pending") {
    await answerCallback(cq.id, "تمت المعالجة مسبقاً · Already handled");
    return;
  }

  if (action === "reject") {
    await updateIntentStatus(intentId, "rejected", "رفضه المستخدم عبر تليجرام.");
    await answerCallback(cq.id, "تم الرفض · Rejected");
    if (messageId)
      await editMessageText(chatId, messageId, "❌ رُفضت التوصية. · Recommendation rejected.");
    return;
  }

  if (action === "approve") {
    await updateIntentStatus(intentId, "approved", "وافق المستخدم عبر تليجرام.");
    const result = await executeIntent(userId, intentId);
    await notifyTradeResult(userId, result, intent.symbol);
    await answerCallback(
      cq.id,
      result.ok ? "تم التنفيذ ✅ · Executed" : "تعذّر التنفيذ · Failed",
    );
    if (messageId) {
      await editMessageText(
        chatId,
        messageId,
        result.ok
          ? `✅ نُفّذت التوصية: ${intent.symbol}. · Executed.`
          : `⚠️ لم تُنفّذ · Not executed: ${result.reason}`,
      );
    }
    return;
  }

  await answerCallback(cq.id);
}
