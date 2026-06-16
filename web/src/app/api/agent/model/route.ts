import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getActiveModel, getActiveProvider, getProviderApiKey } from "@/lib/llm";
import { buildFallbackRefs, modelRefFromPlatform } from "@/lib/agentModelConfig";
import { refreshPlatformConfigCache } from "@/lib/platformConfig";
import { getPublicAppUrl } from "@/lib/appUrl";

/** Bridge: platform AI provider + model (Claude MCP reads via get_agent_capabilities). */
export async function GET(req: NextRequest) {
  try {
    requireAgentAuth(req);
    await refreshPlatformConfigCache();
    const provider = getActiveProvider();
    const model = getActiveModel();
    const ref = modelRefFromPlatform(model);
    const providerKeys: Record<string, string> = {};
    for (const p of ["openai", "google"] as const) {
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
        chart_media:
          "POST binance-capture ثم MEDIA:<chart_url_telegram> (توكن مدمج). لا تستخدم localhost ولا ?token= يدوياً.",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
