import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { listOpenRouterFreeModels } from "@/lib/openaiCompat";
import { getActiveModel, getProviderApiKey, providerKeyField } from "@/lib/llm";
import { getPlatformValue } from "@/lib/platformConfig";

const bodySchema = z.object({
  apiKey: z.string().min(10).optional(),
});

function missingKeyError(): string {
  return `أدخل مفتاح ${providerKeyField("openrouter")} أو احفظه أولاً.`;
}

/**
 * Validate an OpenRouter key (stored or draft) and return the live model list
 * from openrouter.ai — the admin picker is dynamic, not a curated catalogue.
 */
export async function GET() {
  try {
    await requireAdminWith("keys_write");
    const key = getProviderApiKey("openrouter");
    if (!key) {
      return NextResponse.json({ error: missingKeyError() }, { status: 400 });
    }
    const models = await listOpenRouterFreeModels(key);
    return NextResponse.json({
      provider: "openrouter",
      models,
      defaultModel:
        getPlatformValue("OPENROUTER_MODEL")?.trim() || getActiveModel(),
    });
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminWith("keys_write");
    const { apiKey } = bodySchema.parse(await req.json().catch(() => ({})));
    const key = apiKey ?? getProviderApiKey("openrouter");
    if (!key) {
      return NextResponse.json({ error: missingKeyError() }, { status: 400 });
    }
    const models = await listOpenRouterFreeModels(key);
    return NextResponse.json({
      provider: "openrouter",
      models,
      defaultModel:
        getPlatformValue("OPENROUTER_MODEL")?.trim() || getActiveModel(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "مدخلات غير صالحة." }, { status: 400 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleError(err);
  }
}
