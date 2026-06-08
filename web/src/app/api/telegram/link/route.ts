import { NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { createLinkCode, clearTelegramChatId, getTelegramChatId } from "@/lib/store";
import { isTelegramConfigured, getBotUsername } from "@/lib/telegram";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      configured: isTelegramConfigured(),
      linked: Boolean(getTelegramChatId(user.id)),
      botUsername: await getBotUsername(),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { error: "بوت تليجرام غير مُفعّل على الخادم بعد." },
        { status: 503 },
      );
    }
    const code = createLinkCode(user.id);
    const username = await getBotUsername();
    return NextResponse.json({
      code,
      botUsername: username,
      deepLink: username ? `https://t.me/${username}?start=${code}` : null,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    clearTelegramChatId(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
