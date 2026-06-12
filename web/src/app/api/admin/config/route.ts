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
import { syncOpenClawModelFromPlatform } from "@/lib/openclawModelSync";
import {
  getActiveProvider,
  getActiveModel,
} from "@/lib/llm";
import {
  isGeminiChatModelId,
  isGeminiStudioApiKey,
  normalizeGeminiChatModel,
} from "@/lib/gemini";

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

    const nextProvider =
      patch.AI_PROVIDER !== undefined
        ? String(patch.AI_PROVIDER).toLowerCase()
        : getActiveProvider();
    const nextModel =
      patch.AI_MODEL !== undefined
        ? String(patch.AI_MODEL).trim()
        : getActiveModel();

    if (patch.GEMINI_API_KEY !== undefined) {
      const key = String(patch.GEMINI_API_KEY).trim();
      if (key && !isGeminiStudioApiKey(key)) {
        return NextResponse.json(
          {
            error:
              "مفتاح Gemini غير صالح — استخدم مفتاح AI Studio (يبدأ بـ AIza…) من aistudio.google.com/apikey وليس رمز OAuth (AQ.…).",
          },
          { status: 400 },
        );
      }
    }

    if (
      (nextProvider === "google" || nextProvider === "gemini") &&
      patch.AI_MODEL !== undefined &&
      !isGeminiChatModelId(nextModel)
    ) {
      patch.AI_MODEL = normalizeGeminiChatModel(nextModel);
    }

    await savePlatformConfig(patch);
    await logAudit(admin.id, "platform_config", Object.keys(patch).join(", "));

    let agentModelSync: Awaited<
      ReturnType<typeof syncOpenClawModelFromPlatform>
    > | null = null;
    if (
      patch.AI_MODEL !== undefined ||
      patch.AI_PROVIDER !== undefined ||
      patch.ANTHROPIC_MODEL !== undefined ||
      patch.ANTHROPIC_API_KEY !== undefined ||
      patch.OPENROUTER_API_KEY !== undefined ||
      patch.OPENAI_API_KEY !== undefined ||
      patch.GEMINI_API_KEY !== undefined
    ) {
      // savePlatformConfig already refreshed the cache, so the sync reads
      // the new provider/model from platform config directly.
      agentModelSync = await syncOpenClawModelFromPlatform();
    }

    return NextResponse.json({
      ok: true,
      fields: await listPlatformConfigStatus(),
      agentModelSync,
    });
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
