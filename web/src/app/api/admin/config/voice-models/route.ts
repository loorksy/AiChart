import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { listOpenAIRealtimeModels } from "@/lib/openaiCompat";
import { getProviderApiKey, providerKeyField } from "@/lib/llm";
import { getPlatformValueAsync } from "@/lib/platformConfig";

const bodySchema = z.object({
  apiKey: z.string().min(10).optional(),
});

function missingKeyError(): string {
  return `أدخل مفتاح ${providerKeyField("openai")} أو احفظه أولاً.`;
}

async function defaultModel(): Promise<string> {
  return (await getPlatformValueAsync("OPENAI_REALTIME_MODEL"))?.trim() || "gpt-realtime";
}

export async function GET() {
  try {
    await requireAdminWith("keys_write");
    const key = getProviderApiKey("openai");
    if (!key) {
      return NextResponse.json({ error: missingKeyError() }, { status: 400 });
    }
    const models = await listOpenAIRealtimeModels(key);
    return NextResponse.json({
      provider: "openai",
      models,
      defaultModel: await defaultModel(),
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
    await requireAdminWith("keys_write");
    const { apiKey } = bodySchema.parse(await req.json().catch(() => ({})));
    const key = apiKey ?? getProviderApiKey("openai");
    if (!key) {
      return NextResponse.json({ error: missingKeyError() }, { status: 400 });
    }
    const models = await listOpenAIRealtimeModels(key);
    return NextResponse.json({
      provider: "openai",
      models,
      defaultModel: await defaultModel(),
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
