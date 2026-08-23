import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { ANTHROPIC_MODEL_CHOICES, OPENAI_MODEL_CHOICES } from "@/lib/modelCatalog";
import {
  getActiveProviderAsync,
  getProviderApiKey,
  providerKeyField,
  resolveActiveSelection,
  verifyProviderKey,
  type LLMProvider,
} from "@/lib/llm";

const bodySchema = z.object({
  apiKey: z.string().min(10).optional(),
});

function missingKeyError(provider: LLMProvider): string {
  return `أدخل مفتاح ${providerKeyField(provider)} أو احفظه أولاً.`;
}

/** The curated catalogue for whichever provider is actually active. */
function choicesFor(provider: LLMProvider) {
  return provider === "anthropic" ? ANTHROPIC_MODEL_CHOICES : OPENAI_MODEL_CHOICES;
}

/**
 * The admin picks the platform default from the same curated catalogue users
 * see — not from the provider's full listing. The live API call remains solely
 * to prove the key works before it is trusted.
 */
async function curatedModels(provider: LLMProvider, key: string) {
  // Key validation goes through the LLM layer, the only module that speaks to
  // a provider's own endpoint — so this panel cannot grow a second opinion
  // about providers alongside the resolver.
  const verified = await verifyProviderKey(provider, key);
  if (!verified.ok) throw new Error(verified.error);
  return choicesFor(provider).map((m) => ({ id: m.id, label: m.label }));
}

async function activeModelId(): Promise<string> {
  return (await resolveActiveSelection("deep")).model;
}

export async function GET() {
  try {
    await requireAdminWith("keys_write");
    // The ACTIVE provider, not a hard-coded one. This route named OpenAI in
    // seven places, so with the platform pointed at Anthropic the console's
    // "verify key and list models" button answered 400 "enter your
    // OPENAI_API_KEY" — and if an unrelated OpenAI key happened to be stored,
    // it listed the wrong provider's catalogue as the deep-model picker.
    const provider = await getActiveProviderAsync();
    const key = getProviderApiKey(provider);
    if (!key) {
      return NextResponse.json({ error: missingKeyError(provider) }, { status: 400 });
    }
    return NextResponse.json({
      provider,
      models: await curatedModels(provider, key),
      defaultModel: await activeModelId(),
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
    const provider = await getActiveProviderAsync();
    const key = apiKey ?? getProviderApiKey(provider);
    if (!key) {
      return NextResponse.json({ error: missingKeyError(provider) }, { status: 400 });
    }
    return NextResponse.json({
      provider,
      models: await curatedModels(provider, key),
      defaultModel: await activeModelId(),
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
