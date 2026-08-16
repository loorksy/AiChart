import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { getPublicAppUrl } from "@/lib/appUrl";
import {
  isTelegramConfiguredAsync,
  deleteWebhook,
  setWebhook,
} from "@/lib/telegram";

/**
 * Admin-only: register or release this deployment's Telegram webhook.
 *
 * The bot used to be outbound-only and this route existed to DELETE the
 * webhook permanently — the platform pushed cards and an operator had nowhere
 * to ask for one. Telegram is a full surface now: POST registers the inbound
 * endpoint, DELETE takes it back down.
 */
export async function POST() {
  try {
    await requireAdmin();
    if (!(await isTelegramConfiguredAsync())) {
      return NextResponse.json(
        { error: "بوت تليجرام غير مُعدّ (TELEGRAM_BOT_TOKEN مفقود)." },
        { status: 503 },
      );
    }
    const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
    if (!secret) {
      // Registering without a secret would expose an endpoint that runs the
      // decision engine to anyone who guesses its URL.
      return NextResponse.json(
        { error: "TELEGRAM_WEBHOOK_SECRET مفقود — لا يمكن تسجيل webhook بلا رمز تحقق." },
        { status: 503 },
      );
    }
    const url = `${getPublicAppUrl()}/api/telegram/webhook`;
    await setWebhook(url, secret);
    return NextResponse.json({
      ok: true,
      url,
      message: "سُجّل الـ webhook — يمكن الآن سؤال البوت عن الذهب مباشرة.",
    });
  } catch (err) {
    return handleError(err);
  }
}

/** Take the inbound surface back down; the bot keeps sending notifications. */
export async function DELETE() {
  try {
    await requireAdmin();
    if (!(await isTelegramConfiguredAsync())) {
      return NextResponse.json(
        { error: "بوت تليجرام غير مُعدّ (TELEGRAM_BOT_TOKEN مفقود)." },
        { status: 503 },
      );
    }
    await deleteWebhook();
    return NextResponse.json({
      ok: true,
      message: "أُزيل الـ webhook — البوت يرسل الإشعارات فقط الآن.",
    });
  } catch (err) {
    return handleError(err);
  }
}
