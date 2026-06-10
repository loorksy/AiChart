import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import { getAudioModel, listOpenRouterAudioModels } from "@/lib/openrouter";

const bodySchema = z.object({
  apiKey: z.string().min(10).optional(),
});

/** Admin: audio-capable OpenRouter models (stored key or draft before save). */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { apiKey } = bodySchema.parse(await req.json().catch(() => ({})));
    const models = await listOpenRouterAudioModels(apiKey);
    return NextResponse.json({
      models,
      defaultModel: await getAudioModel(),
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
