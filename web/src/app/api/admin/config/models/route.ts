import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import { listAnthropicModels } from "@/lib/anthropic";
import {
  listOpenAIChatModels,
  listOpenRouterChatModels,
} from "@/lib/openaiCompat";
import {
  getActiveModel,
  getProviderApiKey,
  providerKeyField,
  type LLMProvider,
} from "@/lib/llm";

const providerSchema = z.enum(["anthropic", "openrouter", "openai"]);

const bodySchema = z.object({
  provider: providerSchema.optional(),
  apiKey: z.string().min(10).optional(),
});

interface NormalizedModel {
  id: string;
  display_name: string;
}

async function fetchModels(
  provider: LLMProvider,
  key: string,
): Promise<NormalizedModel[]> {
  if (provider === "anthropic") {
    const models = await listAnthropicModels(key);
    return models.map((m) => ({ id: m.id, display_name: m.display_name }));
  }
  if (provider === "openrouter") return listOpenRouterChatModels(key);
  return listOpenAIChatModels(key);
}

function missingKeyError(provider: LLMProvider): string {
  return `أدخل مفتاح ${providerKeyField(provider)} أو احفظه أولاً.`;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const raw = req.nextUrl.searchParams.get("provider") ?? "anthropic";
    const provider = providerSchema.catch("anthropic").parse(raw);
    const key = getProviderApiKey(provider);
    if (!key) {
      return NextResponse.json(
        { error: missingKeyError(provider) },
        { status: 400 },
      );
    }
    const models = await fetchModels(provider, key);
    return NextResponse.json({
      provider,
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
    const { provider = "anthropic", apiKey } = bodySchema.parse(
      await req.json().catch(() => ({})),
    );
    const key = apiKey ?? getProviderApiKey(provider);
    if (!key) {
      return NextResponse.json(
        { error: missingKeyError(provider) },
        { status: 400 },
      );
    }
    const models = await fetchModels(provider, key);
    return NextResponse.json({
      provider,
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
