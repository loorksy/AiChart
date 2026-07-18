import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getProviderApiKey } from "@/lib/llm";
import {
  getCachedModelRegistry,
  pickDefaultModelId,
  projectPublicModels,
} from "@/lib/agent/modelFirst/modelRegistry";
import { stubProbedRegistry } from "@/lib/agent/modelFirst/probeModels";
import { getUserModelPreferences } from "@/lib/agent/modelFirst/userModelPreferences";

/**
 * User-facing trading model catalogue (safe projection only).
 * Does not expose API keys, probe errors, or unrestricted provider catalogue.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(request);
    let records = getCachedModelRegistry();
    if (!records?.length) {
      // Until admin refresh probes under the production key, expose a safe stub
      // allowlist so the composer is usable in local/dev. Probe replaces this.
      records = stubProbedRegistry(["gpt-4.1", "o3-mini", "o4-mini"]);
    }
    const models = projectPublicModels(records);
    const prefs = await getUserModelPreferences(userId);
    const defaultModelId = pickDefaultModelId(records);
    return NextResponse.json({
      models,
      preferredModelId: prefs.modelId,
      preferredReasoningEffort: prefs.reasoningEffort,
      defaultModelId,
      probed: Boolean(getCachedModelRegistry()?.length),
      keyConfigured: Boolean(getProviderApiKey("openai")),
      note:
        "Platform model preference applies to AiChart trading analysis only. MCP hosts (Claude, ChatGPT, Cursor) keep their own model authority.",
    });
  } catch (error) {
    return handleError(error);
  }
}
