import { NextResponse } from "next/server";
import { handleError, requirePlatformAccess } from "@/lib/api";
import { getProviderApiKey } from "@/lib/llm";
import {
  pickDefaultModelId,
  projectPublicModels,
} from "@/lib/agent/modelFirst/modelRegistry";
import { loadModelRegistry } from "@/lib/agent/modelFirst/modelRegistryStore";
import { getUserModelPreferences } from "@/lib/agent/modelFirst/userModelPreferences";

/**
 * User-facing trading model catalogue (safe projection only).
 * Session-auth for the in-app composer (not MCP bridge token).
 */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const records = (await loadModelRegistry()) ?? [];
    const models = projectPublicModels(records);
    const prefs = records.length
      ? await getUserModelPreferences(user.id)
      : {
          modelId: null,
          reasoningEffort: null,
          selectionRequired: true,
          selectionError: "model_registry_unavailable" as const,
        };
    const defaultModelId = pickDefaultModelId(records);
    return NextResponse.json({
      models,
      preferredModelId: prefs.modelId,
      preferredReasoningEffort: prefs.reasoningEffort,
      selectionRequired: prefs.selectionRequired,
      selectionError: prefs.selectionError,
      defaultModelId,
      probed: records.length > 0,
      keyConfigured: Boolean(getProviderApiKey("openai")),
      note:
        "Platform model preference applies to AiChart trading analysis only. MCP hosts (Claude, ChatGPT, Cursor) keep their own model authority.",
    });
  } catch (error) {
    return handleError(error);
  }
}
