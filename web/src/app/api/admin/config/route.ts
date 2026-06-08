import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import {
  listPlatformConfigStatus,
  savePlatformConfig,
  PLATFORM_CONFIG_FIELDS,
} from "@/lib/platformConfig";
import { logAudit } from "@/lib/store";
import { isTelegramConfigured, setWebhook, setBotCommands } from "@/lib/telegram";
import { getPlatformValue } from "@/lib/platformConfig";

const patchSchema = z.record(z.string(), z.union([z.string(), z.boolean()]).optional());

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ fields: await listPlatformConfigStatus() });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = patchSchema.parse(await req.json());
    const allowed = new Set(PLATFORM_CONFIG_FIELDS.map((f) => f.key));
    const patch: Record<string, string | boolean | undefined> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowed.has(key)) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "لا توجد حقول صالحة للحفظ." }, { status: 400 });
    }
    await savePlatformConfig(patch);
    await logAudit(admin.id, "platform_config", Object.keys(patch).join(", "));
    return NextResponse.json({ ok: true, fields: await listPlatformConfigStatus() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}

/** Register Telegram webhook using APP_URL from config. */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { error: "أضِف TELEGRAM_BOT_TOKEN أولاً." },
        { status: 503 },
      );
    }
    const appUrl = getPlatformValue("APP_URL");
    if (!appUrl) {
      return NextResponse.json(
        { error: "أضِف APP_URL أولاً." },
        { status: 400 },
      );
    }
    const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;
    await setWebhook(webhookUrl);
    await setBotCommands();
    return NextResponse.json({ ok: true, webhookUrl });
  } catch (err) {
    return handleError(err);
  }
}
