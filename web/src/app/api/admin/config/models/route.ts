import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import { listAnthropicModels, getAnthropicModel } from "@/lib/anthropic";
import { getPlatformValue } from "@/lib/platformConfig";

const bodySchema = z.object({
  apiKey: z.string().min(10).optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    if (!getPlatformValue("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { error: "أضِف ANTHROPIC_API_KEY أولاً." },
        { status: 400 },
      );
    }
    const models = await listAnthropicModels();
    return NextResponse.json({
      models,
      defaultModel: getAnthropicModel(),
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
    const key = apiKey ?? getPlatformValue("ANTHROPIC_API_KEY");
    if (!key) {
      return NextResponse.json(
        { error: "أدخل مفتاح Claude أو احفظه أولاً." },
        { status: 400 },
      );
    }
    const models = await listAnthropicModels(key);
    return NextResponse.json({
      models,
      defaultModel: getAnthropicModel(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "مفتاح غير صالح." }, { status: 400 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleError(err);
  }
}
