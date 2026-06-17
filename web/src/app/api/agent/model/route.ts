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
    const forexBackend = process.env.FOREX_BACKEND?.trim() || "auto";
    return NextResponse.json({
      provider,
      model,
      ref,
      fallbacks: buildFallbackRefs(ref),
      providerKeys,
      app_url: getPublicAppUrl(),
      serverVersion: "1.1.0",
      forex_backend: forexBackend,
      featureFlags: {
        confidenceGate: true,
        minConfidenceDefault: 80,
        bridgeErrorEnvelope: true,
        eaGetOhlc: true,
        eaReconnect: true,
        inlineChartBase64: true,
        openTradeIdempotency: true,
        eaHeartbeatDebounce: true,
      },
      eaHeartbeat: {
        offlineAfterMissed: 3,
        heartbeatIntervalSec: 30,
        note_ar:
          "يُعلَن EA offline بعد 3 heartbeats متتالية فائتة — لا نفترض انقطاعاً فورياً عند miss واحد",
        note: "EA marked offline only after 3 consecutive missed heartbeats (~90s worst case)",
      },
      notes: {
        chart_media:
          "POST binance-capture ثم MEDIA:<chart_url_telegram> (توكن مدمج). لا تستخدم localhost ولا ?token= يدوياً.",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
