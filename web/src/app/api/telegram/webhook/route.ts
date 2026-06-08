import { NextRequest, NextResponse } from "next/server";
import {
  consumeLinkCode,
  setTelegramChatId,
  getUserByTelegramChatId,
  getSettings,
  updateSettings,
  countOpenTrades,
  listTrades,
  getIntent,
  updateIntentStatus,
} from "@/lib/store";
import { executeIntent } from "@/lib/execution";
import {
  sendMessage,
  answerCallback,
  editMessageText,
  webhookSecret,
} from "@/lib/telegram";

interface TgUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
}

const HELP = [
  "<b>أوامر AiChart</b>",
  "/status — حالة حسابك",
  "/positions — الصفقات المفتوحة",
  "/pnl — أرباح/خسائر اليوم",
  "/pause — إيقاف التداول مؤقتاً",
  "/resume — استئناف التداول",
  "/stop — إيقاف طارئ",
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
    } else if (update.message?.text) {
      await handleMessage(update.message.chat.id, update.message.text.trim());
    }
  } catch (e) {
    console.error("[telegram] webhook error", e);
  }

  // Always 200 so Telegram doesn't retry indefinitely.
  return NextResponse.json({ ok: true });
}

async function handleMessage(chatId: number, text: string) {
  const cid = String(chatId);

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (code) {
      const userId = consumeLinkCode(code);
      if (userId) {
        setTelegramChatId(userId, cid);
        await sendMessage(
          chatId,
          "✅ تم ربط حسابك بنجاح! ستصلك إشعارات الصفقات والتوصيات هنا.\n\n" + HELP,
        );
        return;
      }
      await sendMessage(chatId, "⚠️ رمز الربط غير صالح أو منتهٍ. أنشئ رمزاً جديداً من الموقع.");
      return;
    }
    await sendMessage(
      chatId,
      "أهلاً بك في <b>AiChart</b> 🤖\nاربط حسابك من إعدادات الموقع للحصول على رمز، ثم أرسله هنا.",
    );
    return;
  }

  const userId = getUserByTelegramChatId(cid);
  if (!userId) {
    await sendMessage(chatId, "حسابك غير مربوط. اربطه من إعدادات الموقع أولاً.");
    return;
  }

  const cmd = text.split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case "/status": {
      const s = getSettings(userId);
      await sendMessage(
        chatId,
        [
          "<b>📊 حالة حسابك</b>",
          `الوضع: ${s.mode === "auto" ? "تنفيذ تلقائي" : "توصيات فقط"}`,
          `الإيقاف الطارئ: ${s.kill_switch ? "🔴 مفعّل" : "🟢 متوقف"}`,
          `الصفقات المفتوحة: ${countOpenTrades(userId)}`,
        ].join("\n"),
      );
      break;
    }
    case "/positions": {
      const open = listTrades(userId, 50).filter((t) => t.status === "open");
      if (!open.length) {
        await sendMessage(chatId, "لا توجد صفقات مفتوحة.");
        break;
      }
      await sendMessage(
        chatId,
        "<b>الصفقات المفتوحة</b>\n" +
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
      const trades = listTrades(userId, 200).filter(
        (t) => t.status === "closed" && t.closed_at?.slice(0, 10) === new Date().toISOString().slice(0, 10),
      );
      const pnl = trades.reduce((a, t) => a + t.pnl, 0);
      await sendMessage(
        chatId,
        `<b>💰 أرباح/خسائر اليوم</b>\n${pnl >= 0 ? "🟢 +" : "🔴 "}${pnl.toFixed(2)} USDT (${trades.length} صفقة مغلقة)`,
      );
      break;
    }
    case "/pause":
    case "/stop": {
      updateSettings(userId, { kill_switch: 1 });
      await sendMessage(chatId, "🔴 تم إيقاف التداول. لن يفتح الوكيل أي صفقة جديدة.");
      break;
    }
    case "/resume": {
      updateSettings(userId, { kill_switch: 0 });
      await sendMessage(chatId, "🟢 تم استئناف التداول.");
      break;
    }
    default:
      await sendMessage(chatId, HELP);
  }
}

async function handleCallback(cq: NonNullable<TgUpdate["callback_query"]>) {
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  if (!chatId || !cq.data) {
    await answerCallback(cq.id);
    return;
  }
  const userId = getUserByTelegramChatId(String(chatId));
  if (!userId) {
    await answerCallback(cq.id, "حسابك غير مربوط.");
    return;
  }

  const [action, idStr] = cq.data.split(":");
  const intentId = Number(idStr);
  const intent = getIntent(intentId);
  if (!intent || intent.user_id !== userId) {
    await answerCallback(cq.id, "الطلب غير موجود.");
    return;
  }
  if (intent.status !== "pending") {
    await answerCallback(cq.id, "تمت معالجة الطلب مسبقاً.");
    return;
  }

  if (action === "reject") {
    updateIntentStatus(intentId, "rejected", "رفضه المستخدم عبر تليجرام.");
    await answerCallback(cq.id, "تم الرفض.");
    if (messageId) await editMessageText(chatId, messageId, "❌ رُفضت التوصية.");
    return;
  }

  if (action === "approve") {
    updateIntentStatus(intentId, "approved", "وافق المستخدم عبر تليجرام.");
    const result = await executeIntent(userId, intentId);
    await answerCallback(cq.id, result.ok ? "تم التنفيذ ✅" : "تعذّر التنفيذ");
    if (messageId) {
      await editMessageText(
        chatId,
        messageId,
        result.ok
          ? `✅ نُفّذت التوصية: ${intent.symbol}.`
          : `⚠️ لم تُنفّذ: ${result.reason}`,
      );
    }
    return;
  }

  await answerCallback(cq.id);
}
