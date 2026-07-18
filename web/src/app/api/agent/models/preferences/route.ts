import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { logAudit } from "@/lib/store";
import { ReasoningEffortSchema } from "@/lib/agent/modelFirst/modelRegistry";
import { saveUserModelPreferences } from "@/lib/agent/modelFirst/userModelPreferences";

const patchSchema = z
  .object({
    modelId: z.string().min(1).max(120).optional(),
    reasoningEffort: ReasoningEffortSchema.optional(),
  })
  .strict()
  .refine((v) => v.modelId != null || v.reasoningEffort != null, {
    message: "empty_patch",
  });

export async function PATCH(request: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(request);
    const input = patchSchema.parse(await request.json());
    const prefs = await saveUserModelPreferences(userId, {
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
    });
    await logAudit(
      userId,
      "model_preference_update",
      `model=${prefs.modelId};reasoning=${prefs.reasoningEffort ?? "none"}`,
    );
    return NextResponse.json({
      ok: true,
      preferredModelId: prefs.modelId,
      preferredReasoningEffort: prefs.reasoningEffort,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "invalid_input" },
        { status: 400 },
      );
    }
    if (error instanceof Error) {
      const code = error.message;
      if (
        code === "model_not_allowed" ||
        code === "model_unavailable" ||
        code === "model_capabilities_insufficient" ||
        code === "reasoning_unsupported"
      ) {
        return NextResponse.json({ error: code }, { status: 400 });
      }
    }
    return handleError(error);
  }
}
