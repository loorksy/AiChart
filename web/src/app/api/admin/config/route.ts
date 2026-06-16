import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import {
  listPlatformConfigStatus,
  savePlatformConfig,
  PLATFORM_CONFIG_FIELDS,
} from "@/lib/platformConfig";
import { logAudit } from "@/lib/store";
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

    if (patch.AI_PROVIDER !== undefined) {
      const p = String(patch.AI_PROVIDER).toLowerCase();
      if (p === "openrouter" || p === "gemini") patch.AI_PROVIDER = "google";
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

    return NextResponse.json({
      ok: true,
      fields: await listPlatformConfigStatus(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
