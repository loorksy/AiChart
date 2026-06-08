import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import { isTelegramConfigured, setWebhook, setBotCommands } from "@/lib/telegram";

const schema = z.object({ baseUrl: z.string().url() });

/** Admin-only: registers the Telegram webhook at <baseUrl>/api/telegram/webhook. */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { error: "بوت تليجرام غير مُعدّ (TELEGRAM_BOT_TOKEN مفقود)." },
        { status: 503 },
      );
    }
    const { baseUrl } = schema.parse(await req.json());
    const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
    await setWebhook(webhookUrl);
    await setBotCommands();
    return NextResponse.json({ ok: true, webhookUrl });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "رابط غير صالح." }, { status: 400 });
    }
    return handleError(err);
  }
}
