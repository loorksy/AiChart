import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { isTelegramConfigured, deleteWebhook } from "@/lib/telegram";

/**
 * Admin-only: releases the bot from any web-managed webhook so the OpenClaw
 * gateway can own the Telegram conversation. The web app keeps using the bot
 * token for outbound notifications only.
 */
export async function POST() {
  try {
    await requireAdmin();
    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { error: "بوت تليجرام غير مُعدّ (TELEGRAM_BOT_TOKEN مفقود)." },
        { status: 503 },
      );
    }
    await deleteWebhook();
    return NextResponse.json({
      ok: true,
      message:
        "أُزيل الـ webhook — محادثة البوت يديرها وكيل OpenClaw الآن، والمنصة ترسل الإشعارات فقط.",
    });
  } catch (err) {
    return handleError(err);
  }
}
