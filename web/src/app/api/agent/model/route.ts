import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getActiveModel, getActiveProvider, getProviderApiKey } from "@/lib/llm";
import { buildFallbackRefs, modelRefFromPlatform } from "@/lib/openclawModelSync";
import { refreshPlatformConfigCache } from "@/lib/platformConfig";
import { getPublicAppUrl } from "@/lib/appUrl";

/**
 * Bridge: the AI provider + model chosen in the admin panel — lets the
 * OpenClaw gateway follow the same selection (see agent/scripts/sync-model.sh).
 */
export async function GET(req: NextRequest) {
  try {
    requireAgentAuth(req);
    await refreshPlatformConfigCache();
    const provider = getActiveProvider();
    const model = getActiveModel();
    const ref = modelRefFromPlatform(model);
    // OpenAI-compatible provider keys so the gateway script can register
    // them in openclaw.json (same trusted bridge token as trading ops).
    const providerKeys: Record<string, string> = {};
    for (const p of ["openrouter", "openai", "google"] as const) {
      const key = getProviderApiKey(p);
      if (key) providerKeys[p] = key;
    }
    return NextResponse.json({
      provider,
      model,
      ref,
      fallbacks: buildFallbackRefs(ref),
      providerKeys,
      app_url: getPublicAppUrl(),
      notes: {
        billing_402:
          "OpenRouter 402 مع رصيد متبقٍ غالباً يعني max_tokens مرتفع — maxTokens=8192 في openclaw.json.",
        chart_media:
          "لا تستخدم GET localhost/binance-capture. POST binance-capture ثم chart_url_public أو image_base64.",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
