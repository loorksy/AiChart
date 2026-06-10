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
import { closeAllOpenTrades } from "@/lib/tradeClose";
import { clearTelegramPending } from "@/lib/telegramPending";
import {
  handleApproveStart,
  handleAmountSelect,
  handleAmountCustom,
  handleCustomAmountText,
  handleRescanYes,
  handleRescanConfirm,
  handleRescanNo,
} from "@/lib/telegramIntentFlow";
import {
  sendMessage,
  answerCallback,
  editMessageText,
  webhookSecret,
  downloadTelegramPhoto,
} from "@/lib/telegram";
import {
  actionResultCard,
  agentReplyCard,
  analyzingCard,
  helpCard,
  isMenuCallback,
  linkedSuccessCard,
  mainMenuKeyboard,
  menuWithBackKeyboard,
  notLinkedCard,
  parseMenuAction,
  pnlCard,
  positionsCard,
  quotaExceededCard,
  statusCard,
  welcomeCard,
  welcomeKeyboard,
} from "@/lib/telegramBotUi";
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

export async function POST(req: NextRequest) {
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

  return NextResponse.json({ ok: true });
}

async function userQuota(userId: number) {
  const limits = await getLimits(userId);
  const used = await getTodayUsage(userId);
  return { used, limit: limits.claude_quota };
}

async function renderMenuAction(
  userId: number,
  action: string,
): Promise<{ text: string; toast?: string }> {
  switch (action) {
    case "status":
    case "refresh": {
      const s = await getSettings(userId);
      const open = await countOpenTrades(userId);
      const quota = await userQuota(userId);
      return { text: statusCard(s, open, quota), toast: "تم التحديث ✓" };
    }
    case "positions": {
      const open = (await listTrades(userId, 50)).filter((t) => t.status === "open");
      return { text: positionsCard(open) };
    }
    case "pnl": {
      const today = new Date().toISOString().slice(0, 10);
      const trades = (await listTrades(userId, 200)).filter(
        (t) => t.status === "closed" && t.closed_at?.slice(0, 10) === today,
      );
      const pnl = trades.reduce((a, t) => a + t.pnl, 0);
      return { text: pnlCard(pnl, trades.length) };
    }
    case "pause": {
      await updateSettings(userId, { kill_switch: 1 });
      const closeResult = await closeAllOpenTrades(userId);
      const closeNote =
        closeResult.closed > 0
          ? `\nأُغلقت ${closeResult.closed} صفقة مفتوحة.`
          : "";
      return {
        text: actionResultCard(
          "🔴",
          "تم إيقاف التداول",
          `لن يفتح الوكيل أي صفقة جديدة حتى تستأنف.${closeNote}`,
        ),
        toast: "تم الإيقاف",
      };
    }
    case "resume": {
      await updateSettings(userId, { kill_switch: 0 });
      return {
        text: actionResultCard("🟢", "تم استئناف التداول", "الوكيل يعمل مجدداً."),
        toast: "تم الاستئناف",
      };
    }
    case "help":
      return { text: helpCard() };
    case "home":
      return { text: welcomeCard(true), toast: "القائمة الرئيسية" };
    default:
      return { text: helpCard() };
  }
}

async function sendPanel(
  chatId: number,
  text: string,
  keyboard = menuWithBackKeyboard(),
): Promise<void> {
  await sendMessage(chatId, text, keyboard);
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
    await sendMessage(chatId, notLinkedCard());
    return;
  }

  if (!isAnthropicConfigured()) {
    await sendPanel(chatId, helpCard());
    return;
  }

  const quota = await userQuota(userId);
  if (quota.limit > 0 && quota.used >= quota.limit) {
    await sendPanel(chatId, quotaExceededCard());
    return;
  }

  const largest = photos[photos.length - 1]!;
  const loadingId = await sendMessage(chatId, analyzingCard());

  try {
    const downloaded = await downloadTelegramPhoto(largest.file_id);
    const validated = validateChatImage(downloaded.media_type, downloaded.data);
    if (!validated.ok) {
      await editMessageText(chatId, loadingId, validated.error, menuWithBackKeyboard());
      return;
    }

    const result = await runTelegramAgentChat(
      userId,
      caption ?? "",
      validated.image,
    );
    if (!result.ok) {
      await editMessageText(chatId, loadingId, result.error, menuWithBackKeyboard());
      return;
    }
    await editMessageText(
      chatId,
      loadingId,
      agentReplyCard(result.reply),
      menuWithBackKeyboard(),
    );
  } catch (e) {
    console.error("[telegram] photo analysis", e);
    await editMessageText(
      chatId,
      loadingId,
      actionResultCard("⚠️", "تعذّر التحليل", "حاول لاحقاً أو أرسل صورة أوضح."),
      menuWithBackKeyboard(),
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
        await sendPanel(chatId, linkedSuccessCard(), welcomeKeyboard());
        return;
      }
      await sendMessage(
        chatId,
        actionResultCard(
          "⚠️",
          "رمز ربط غير صالح",
          "سجّل الدخول عبر تليجرام من الموقع.",
        ),
      );
      return;
    }

    if (fromId) {
      const user = await getUserByTelegramId(fromId);
      if (user) {
        await setTelegramChatId(user.id, cid);
        await sendPanel(chatId, welcomeCard(true), welcomeKeyboard());
        return;
      }
    }

    await sendPanel(chatId, welcomeCard(false), welcomeKeyboard());
    return;
  }

  const userId = await getUserByTelegramChatId(cid);
  if (!userId) {
    await sendMessage(chatId, notLinkedCard());
    return;
  }

  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, "");
  const menuAction =
    cmd === "/status" || cmd === "/refresh"
      ? "status"
      : cmd === "/positions"
        ? "positions"
        : cmd === "/pnl"
          ? "pnl"
          : cmd === "/pause" || cmd === "/stop"
            ? "pause"
            : cmd === "/resume"
              ? "resume"
              : cmd === "/help"
                ? "help"
                : null;

  if (menuAction) {
    const { text: body } = await renderMenuAction(userId, menuAction);
    await sendPanel(chatId, body);
    return;
  }

  if (!text.startsWith("/")) {
    const handledAmount = await handleCustomAmountText(userId, text, chatId);
    if (handledAmount) return;
  }

  if (!text.startsWith("/") && isAnthropicConfigured()) {
    const quota = await userQuota(userId);
    if (quota.limit > 0 && quota.used >= quota.limit) {
      await sendPanel(chatId, quotaExceededCard());
      return;
    }

    const loadingId = await sendMessage(chatId, analyzingCard());
    try {
      const result = await runTelegramAgentChat(userId, text);
      if (!result.ok) {
        await editMessageText(chatId, loadingId, result.error, menuWithBackKeyboard());
        return;
      }
      await editMessageText(
        chatId,
        loadingId,
        agentReplyCard(result.reply),
        menuWithBackKeyboard(),
      );
    } catch (e) {
      console.error("[telegram] agent chat", e);
      await editMessageText(
        chatId,
        loadingId,
        actionResultCard("⚠️", "تعذّر الرد", "حاول لاحقاً."),
        menuWithBackKeyboard(),
      );
    }
    return;
  }

  await sendPanel(chatId, helpCard());
}

async function handleCallback(cq: NonNullable<TgUpdate["callback_query"]>) {
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  if (!chatId || !cq.data) {
    await answerCallback(cq.id);
    return;
  }

  if (isMenuCallback(cq.data)) {
    const userId = await getUserByTelegramChatId(String(chatId));
    if (!userId) {
      await answerCallback(cq.id, "الحساب غير مربوط", true);
      return;
    }

    const action = parseMenuAction(cq.data);
    if (!action) {
      await answerCallback(cq.id);
      return;
    }

    const { text, toast } = await renderMenuAction(userId, action);
    await answerCallback(cq.id, toast);
    const keyboard =
      action === "home" ? welcomeKeyboard() : menuWithBackKeyboard();
    if (messageId) {
      await editMessageText(chatId, messageId, text, keyboard);
    } else {
      await sendMessage(chatId, text, keyboard);
    }
    return;
  }

  const userId = await getUserByTelegramChatId(String(chatId));
  if (!userId) {
    await answerCallback(cq.id, "حسابك غير مربوط");
    return;
  }

  const parts = cq.data.split(":");
  const action = parts[0];
  const intentId = Number(parts[1]);
  const intent = await getIntent(intentId);

  if (action === "reject") {
    if (!intent || intent.user_id !== userId) {
      await answerCallback(cq.id, "الطلب غير موجود");
      return;
    }
    await updateIntentStatus(intentId, "rejected", "رفضه المستخدم عبر تليجرام.");
    await clearTelegramPending(userId);
    await answerCallback(cq.id, "تم الرفض");
    if (messageId) {
      await editMessageText(
        chatId,
        messageId,
        actionResultCard("❌", "رُفضت التوصية", `${intent.symbol} — لم يُنفَّذ.`),
        null,
      );
    }
    return;
  }

  if (!intent || intent.user_id !== userId) {
    await answerCallback(cq.id, "الطلب غير موجود");
    return;
  }

  if (!messageId) {
    await answerCallback(cq.id);
    return;
  }

  if (action === "approve" && intent.status === "pending") {
    await handleApproveStart(userId, intent, chatId, messageId, cq.id);
    return;
  }

  if (action === "amount" && intent.status === "pending") {
    const notional = Number(parts[2]);
    await handleAmountSelect(
      userId,
      intent,
      notional,
      chatId,
      messageId,
      cq.id,
    );
    return;
  }

  if (action === "amount_custom" && intent.status === "pending") {
    await handleAmountCustom(userId, intent, chatId, messageId, cq.id);
    return;
  }

  if (action === "rescan" && parts[1] === "yes") {
    const rid = Number(parts[2]);
    const rIntent = await getIntent(rid);
    if (!rIntent || rIntent.user_id !== userId) {
      await answerCallback(cq.id, "الطلب غير موجود");
      return;
    }
    await handleRescanYes(userId, rIntent, chatId, messageId, cq.id);
    return;
  }

  if (action === "rescan" && parts[1] === "confirm") {
    const rid = Number(parts[2]);
    const rIntent = await getIntent(rid);
    if (!rIntent || rIntent.user_id !== userId) {
      await answerCallback(cq.id, "الطلب غير موجود");
      return;
    }
    await handleRescanConfirm(userId, rIntent, chatId, messageId, cq.id);
    return;
  }

  if (action === "rescan" && parts[1] === "no") {
    const rid = Number(parts[2]);
    const rIntent = await getIntent(rid);
    if (!rIntent || rIntent.user_id !== userId) {
      await answerCallback(cq.id, "الطلب غير موجود");
      return;
    }
    await handleRescanNo(userId, rIntent, chatId, messageId, cq.id);
    return;
  }

  await answerCallback(cq.id, "تمت المعالجة مسبقاً");
}
