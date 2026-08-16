import { NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { createLinkCode, clearTelegramChatId, getTelegramChatId } from "@/lib/store";
import {
  isTelegramConfiguredAsync,
  getBotUsername,
  normalizeBotUsername,
} from "@/lib/telegram";

export async function GET() {
  try {
    const user = await requireUser();
    const botUsername = normalizeBotUsername(await getBotUsername());
    return NextResponse.json({
      configured: await isTelegramConfiguredAsync(),
      linked: Boolean(await getTelegramChatId(user.id)),
      botUsername,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    if (!(await isTelegramConfiguredAsync())) {
      return NextResponse.json(
        { error: "بوت تليجرام غير مُفعّل على الخادم بعد." },
        { status: 503 },
      );
    }
    const code = await createLinkCode(user.id);
    const username = normalizeBotUsername(await getBotUsername());
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
    await clearTelegramChatId(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
