import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { listOpenAIChatModels } from "@/lib/openaiCompat";
import { OPENAI_MODEL_CHOICES } from "@/lib/modelCatalog";
import { getActiveModel, getProviderApiKey, providerKeyField } from "@/lib/llm";

const bodySchema = z.object({
  apiKey: z.string().min(10).optional(),
});

function missingKeyError(): string {
  return `أدخل مفتاح ${providerKeyField("openai")} أو احفظه أولاً.`;
}

/**
 * The admin picks the platform default from the same curated catalogue users
 * see — not from the provider's full listing. The live API call remains solely
 * to prove the key works before it is trusted.
 */
async function curatedModels(key: string) {
  await listOpenAIChatModels(key);
  return OPENAI_MODEL_CHOICES.map((m) => ({ id: m.id, label: m.label }));
}

export async function GET() {
  try {
    await requireAdminWith("keys_write");
    const key = getProviderApiKey("openai");
    if (!key) {
      return NextResponse.json({ error: missingKeyError() }, { status: 400 });
    }
    return NextResponse.json({
      provider: "openai",
      models: await curatedModels(key),
      defaultModel: getActiveModel(),
    });
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleError(err);
  }
}

/** Validate the stored key or a draft key before save, then list the catalogue. */
export async function POST(req: NextRequest) {
  try {
    await requireAdminWith("keys_write");
    const { apiKey } = bodySchema.parse(await req.json().catch(() => ({})));
    const key = apiKey ?? getProviderApiKey("openai");
    if (!key) {
      return NextResponse.json({ error: missingKeyError() }, { status: 400 });
    }
    return NextResponse.json({
      provider: "openai",
      models: await curatedModels(key),
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
