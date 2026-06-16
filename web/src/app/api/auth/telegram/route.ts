import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setSession } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { upsertTelegramUser, logAudit } from "@/lib/store";
import {
  verifyTelegramLogin,
  type TelegramLoginPayload,
} from "@/lib/telegramAuth";
import {
  getBotUsername,
  isTelegramConfiguredAsync,
} from "@/lib/telegram";
import { getPlatformValueAsync } from "@/lib/platformConfig";

const schema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number().int(),
  hash: z.string().min(1),
  redirectTo: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    if (!(await isTelegramConfiguredAsync())) {
      return NextResponse.json(
        { error: "تسجيل تليجرام غير مُفعّل على الخادم بعد." },
        { status: 503 },
      );
    }

    const token = await getPlatformValueAsync("TELEGRAM_BOT_TOKEN");
    if (!token) {
      return NextResponse.json(
        { error: "توكن البوت غير مُعدّ." },
        { status: 503 },
      );
    }
    const body = schema.parse(await req.json()) as TelegramLoginPayload & {
      redirectTo?: string;
    };

    if (!verifyTelegramLogin(body, token)) {
      return NextResponse.json(
        { error: "فشل التحقق من هوية تليجرام." },
        { status: 401 },
      );
    }

    const { user, isNew } = await upsertTelegramUser(body);
    await setSession({ sub: user.id, email: user.email, role: user.role });

    await logAudit(
      user.id,
      isNew ? "telegram_register" : "telegram_login",
      body.username ? `@${body.username}` : String(body.id),
    );

    const botUsername = await getBotUsername();
    const redirectTo =
      body.redirectTo &&
      body.redirectTo.startsWith("/") &&
      !body.redirectTo.startsWith("//")
        ? body.redirectTo
        : undefined;

    let redirect = redirectTo ?? "/console";
    if (needsMcpCredentials(user)) {
      redirect = "/complete-profile";
    } else if (!hasPlatformAccess(user)) {
      redirect = "/awaiting-approval";
    } else {
      redirect = redirectTo ?? "/console";
    }

    return NextResponse.json({
      user,
      isNew,
      linked: true,
      redirect,
      platform_access: hasPlatformAccess(user),
      botDeepLink: botUsername ? `https://t.me/${botUsername}?start=welcome` : null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
