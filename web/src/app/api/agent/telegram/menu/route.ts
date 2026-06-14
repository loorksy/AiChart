import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { buildAccountProfile } from "@/lib/accountProfile";
import { getTelegramChatId } from "@/lib/store";
import { sessionStartCard } from "@/lib/telegramCards";
import { arabicReplyKeyboardRows } from "@/lib/telegramCommands";
import {
  isTelegramConfigured,
  sendMessageWithReplyKeyboard,
} from "@/lib/telegram";

/** Bridge: welcome card + Arabic reply keyboard for linked Telegram chat. */
export async function POST(_req: NextRequest) {
  try {
    requireAgentAuth(_req);
    const userId = await resolveAgentUserId();

    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { ok: false, delivered: false, reason: "TELEGRAM_BOT_TOKEN غير مُعدّ." },
        { status: 503 },
      );
    }

    const chatId = await getTelegramChatId(userId);
    if (!chatId) {
      return NextResponse.json({
        ok: false,
        delivered: false,
        reason: "لا يوجد telegram_chat_id مرتبط — اربط الحساب من الموقع أو vps-link-telegram-admin.",
      });
    }

    const profile = await buildAccountProfile(userId);
    const text = sessionStartCard(profile);
    await sendMessageWithReplyKeyboard(chatId, text, arabicReplyKeyboardRows());

    return NextResponse.json({
      ok: true,
      delivered: true,
      text,
      keyboard: arabicReplyKeyboardRows(),
    });
  } catch (e) {
    return handleError(e);
  }
}
