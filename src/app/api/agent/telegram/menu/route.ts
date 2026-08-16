import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { buildAccountProfile } from "@/lib/accountProfile";
import { debugSessionLog } from "@/lib/debugSessionLog";
import { getTelegramChatId } from "@/lib/store";
import { rememberOptions } from "@/lib/agent/sessionOptions";
import { sessionStartCard } from "@/lib/telegramCards";
import {
  dismissPersistentKeyboardOnce,
  isTelegramConfigured,
  sendMessage,
} from "@/lib/telegram";
import {
  optionsForTelegramFastPath,
  rememberInlineOptions,
  telegramSessionId,
} from "@/lib/telegram/inlineOptions";

/** Bridge: welcome card + agent-authored inline options for a linked chat. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
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
        reason: "لا يوجد telegram_chat_id مرتبط — اربط الحساب من إعدادات الموقع أولاً.",
      });
    }

    const profile = await buildAccountProfile(userId);
    const text = sessionStartCard(profile);
    const options = optionsForTelegramFastPath("greeting");
    await dismissPersistentKeyboardOnce(chatId);
    rememberOptions(telegramSessionId(String(chatId)), options);
    await sendMessage(
      chatId,
      text,
      rememberInlineOptions(String(chatId), options),
    );
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
      options,
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
