import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import {
  listPlatformConfigStatus,
  savePlatformConfig,
  PLATFORM_CONFIG_FIELDS,
} from "@/lib/platformConfig";
import { logAudit } from "@/lib/store";
import { isTelegramConfigured, deleteWebhook } from "@/lib/telegram";

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

/** Releases the bot webhook — conversation is owned by the OpenClaw gateway. */
export async function POST() {
  try {
    await requireAdmin();
    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { error: "أضِف TELEGRAM_BOT_TOKEN أولاً." },
        { status: 503 },
      );
    }
    await deleteWebhook();
    return NextResponse.json({
      ok: true,
      message: "أُزيل الـ webhook — البوت بيد وكيل OpenClaw.",
    });
  } catch (err) {
    return handleError(err);
  }
}
