import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import { listOpenAIChatModels } from "@/lib/openaiCompat";
import { getActiveModel, getProviderApiKey, providerKeyField } from "@/lib/llm";

const bodySchema = z.object({
  apiKey: z.string().min(10).optional(),
});

function missingKeyError(): string {
  return `أدخل مفتاح ${providerKeyField("openai")} أو احفظه أولاً.`;
}

export async function GET() {
  try {
    await requireAdmin();
    const key = getProviderApiKey("openai");
    if (!key) {
      return NextResponse.json({ error: missingKeyError() }, { status: 400 });
    }
    const models = await listOpenAIChatModels(key);
    return NextResponse.json({
      provider: "openai",
      models,
      defaultModel: getActiveModel(),
    });
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleError(err);
  }
}

/** Fetch models using stored key or a draft key before save. */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { apiKey } = bodySchema.parse(await req.json().catch(() => ({})));
    const key = apiKey ?? getProviderApiKey("openai");
    if (!key) {
      return NextResponse.json({ error: missingKeyError() }, { status: 400 });
    }
    const models = await listOpenAIChatModels(key);
    return NextResponse.json({
      provider: "openai",
      models,
      defaultModel: getActiveModel(),
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
