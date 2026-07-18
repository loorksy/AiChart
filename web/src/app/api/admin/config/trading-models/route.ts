import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import { getProviderApiKey, providerKeyField } from "@/lib/llm";
import { projectPublicModels } from "@/lib/agent/modelFirst/modelRegistry";
import { loadModelRegistry } from "@/lib/agent/modelFirst/modelRegistryStore";
import {
  discoverAndProbeModels,
  missingApprovedModelIds,
} from "@/lib/agent/modelFirst/probeModels";

const bodySchema = z.object({
  apiKey: z.string().min(10).optional(),
});

function missingKeyError(): string {
  return `أدخل مفتاح ${providerKeyField("openai")} أو احفظه أولاً.`;
}

/** Admin: refresh capability probes for trading-eligible models. */
export async function GET() {
  try {
    await requireAdmin();
    const records = (await loadModelRegistry()) ?? [];
    return NextResponse.json({
      models: projectPublicModels(records),
      diagnostics: records.map((r) => ({
        id: r.id,
        available: r.available,
        responsesApi: r.responsesApi,
        vision: r.vision,
        structuredOutputs: r.structuredOutputs,
        supportedReasoningValues: r.supportedReasoningValues,
        eligibleAsDefault: r.eligibleAsDefault,
        costTier: r.costTier,
        lastVerifiedAt: r.lastVerifiedAt,
        probeErrorCodes: r.probeErrors,
      })),
      probed: records.length > 0,
      missingApprovedModelIds: missingApprovedModelIds(
        records.map((record) => record.id),
      ),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { apiKey } = bodySchema.parse(await req.json().catch(() => ({})));
    const key = apiKey ?? getProviderApiKey("openai");
    if (!key) {
      return NextResponse.json({ error: missingKeyError() }, { status: 400 });
    }
    const records = await discoverAndProbeModels(key);
    return NextResponse.json({
      ok: true,
      models: projectPublicModels(records),
      diagnostics: records.map((r) => ({
        id: r.id,
        available: r.available,
        responsesApi: r.responsesApi,
        vision: r.vision,
        structuredOutputs: r.structuredOutputs,
        supportedReasoningValues: r.supportedReasoningValues,
        eligibleAsDefault: r.eligibleAsDefault,
        costTier: r.costTier,
        lastVerifiedAt: r.lastVerifiedAt,
        probeErrorCodes: r.probeErrors,
      })),
      missingApprovedModelIds: missingApprovedModelIds(
        records.map((record) => record.id),
      ),
      note: "Users select models in the chat composer. AI_MODEL is not used as a trading-model fallback.",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "مدخلات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
