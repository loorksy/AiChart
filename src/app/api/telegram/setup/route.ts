import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { isTelegramConfigured, deleteWebhook } from "@/lib/telegram";

/**
 * Admin-only: releases web-managed webhook. Bot is outbound notifications only;
 * trading conversation is via Claude MCP.
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
        "أُزيل الـ webhook — التداول عبر Claude MCP، والمنصة ترسل الإشعارات فقط.",
    });
  } catch (err) {
    return handleError(err);
  }
}
