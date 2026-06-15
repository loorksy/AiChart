import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { buildAccountProfile } from "@/lib/accountProfile";
import { debugSessionLog } from "@/lib/debugSessionLog";
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
    // #region agent log
    debugSessionLog({
      location: "telegram/menu/route.ts:POST",
      message: "menu route entered",
      hypothesisId: "E",
      data: { userId },
    });
    // #endregion

    if (!isTelegramConfigured()) {
      // #region agent log
      debugSessionLog({
        location: "telegram/menu/route.ts:POST",
        message: "telegram not configured",
        hypothesisId: "E",
        data: { userId },
      });
      // #endregion
      return NextResponse.json(
        { ok: false, delivered: false, reason: "TELEGRAM_BOT_TOKEN غير مُعدّ." },
        { status: 503 },
      );
    }

    const chatId = await getTelegramChatId(userId);
    if (!chatId) {
      // #region agent log
      debugSessionLog({
        location: "telegram/menu/route.ts:POST",
        message: "no chat_id linked",
        hypothesisId: "E",
        data: { userId },
      });
      // #endregion
      return NextResponse.json({
        ok: false,
        delivered: false,
        reason: "لا يوجد telegram_chat_id مرتبط — اربط الحساب من الموقع أو vps-link-telegram-admin.",
      });
    }

    const profile = await buildAccountProfile(userId);
    const text = sessionStartCard(profile);
    await sendMessageWithReplyKeyboard(chatId, text, arabicReplyKeyboardRows());
    // #region agent log
    debugSessionLog({
      location: "telegram/menu/route.ts:POST",
      message: "menu delivered",
      hypothesisId: "E",
      data: { userId, chatId: String(chatId).slice(0, 4) + "***" },
    });
    // #endregion

    return NextResponse.json({
      ok: true,
      delivered: true,
      text,
      keyboard: arabicReplyKeyboardRows(),
    });
  } catch (e) {
    // #region agent log
    debugSessionLog({
      location: "telegram/menu/route.ts:POST",
      message: "menu route error",
      hypothesisId: "E",
      data: { error: e instanceof Error ? e.message : String(e) },
    });
    // #endregion
    return handleError(e);
  }
}
