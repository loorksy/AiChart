import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getActiveModel, getActiveProvider, getProviderApiKey } from "@/lib/llm";
import { buildFallbackRefs, modelRefFromPlatform } from "@/lib/agentModelConfig";
import { refreshPlatformConfigCache } from "@/lib/platformConfig";
import { getPublicAppUrl } from "@/lib/appUrl";
import { APP_VERSION, gitCommit } from "@/lib/version";
import { canonicalIdentity, canonicalIdentityHash } from "@/lib/agent/canonicalIdentity";

/** Bridge: platform AI provider + model (Claude MCP reads via get_agent_capabilities). */
export async function GET(req: NextRequest) {
  try {
    requireAgentAuth(req);
    await refreshPlatformConfigCache();
    const provider = getActiveProvider();
    const model = getActiveModel();
    const ref = modelRefFromPlatform(model);
    // SECURITY: never expose key values — only report whether the key is configured.
    const providerConfigured: Record<string, { configured: boolean }> = {
      openai: { configured: Boolean(getProviderApiKey("openai")) },
    };
    const forexBackend = process.env.FOREX_BACKEND?.trim() || "auto";
    return NextResponse.json({
      provider,
      model,
      ref,
      fallbacks: buildFallbackRefs(ref),
      providerConfigured,
      app_url: getPublicAppUrl(),
      serverVersion: APP_VERSION,
      gitCommit: gitCommit(),
      // Identity provenance — hash + source only, never prompt content.
      canonicalPrompt: {
        hash: canonicalIdentityHash(),
        source: canonicalIdentity().source,
      },
      forex_backend: forexBackend,
      eaHeartbeat: {
        offlineAfterMissed: 3,
        heartbeatIntervalSec: 30,
        note_ar:
          "يُعلَن EA offline بعد 3 heartbeats متتالية فائتة — لا نفترض انقطاعاً فورياً عند miss واحد",
        note: "EA marked offline only after 3 consecutive missed heartbeats (~90s worst case)",
      },
      notes: {
        chart_media:
          "POST chart snapshot ثم MEDIA:<chart_url_telegram> (توكن مدمج). لا تستخدم localhost ولا ?token= يدوياً.",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
