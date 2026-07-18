/**
 * Per-user model + reasoning preferences (tenant-scoped).
 */
import { execute, queryOne } from "@/lib/db";
import { ensureUserDefaults } from "@/lib/store";
import {
  type ReasoningEffort,
  ReasoningEffortSchema,
  pickDefaultModelId,
  validateReasoningForModel,
  validateUserModelSelection,
} from "./modelRegistry";
import { loadModelRegistry } from "./modelRegistryStore";

export type UserModelPreferences = {
  modelId: string | null;
  reasoningEffort: ReasoningEffort | null;
  selectionRequired: boolean;
  selectionError: "model_unavailable" | "reasoning_unsupported" | null;
};

async function requireRegistry() {
  const records = await loadModelRegistry();
  if (!records?.length) throw new Error("model_registry_unavailable");
  return records;
}

export async function getUserModelPreferences(
  userId: number,
): Promise<UserModelPreferences> {
  await ensureUserDefaults(userId);
  const row = await queryOne<{
    preferred_model?: string | null;
    preferred_reasoning_effort?: string | null;
  }>(
    `SELECT preferred_model, preferred_reasoning_effort
       FROM trading_settings WHERE user_id = ?`,
    [userId],
  ).catch(() => null);

  const records = await requireRegistry();
  const savedModel = row?.preferred_model?.trim() || null;
  let modelId: string | null = null;
  if (savedModel) {
    const v = validateUserModelSelection(savedModel, records);
    if (!v.ok) {
      return {
        modelId: null,
        reasoningEffort: null,
        selectionRequired: true,
        selectionError: "model_unavailable",
      };
    }
    modelId = v.record.id;
  }
  if (!modelId) modelId = pickDefaultModelId(records);

  const savedEffortRaw = row?.preferred_reasoning_effort?.trim();
  if (savedEffortRaw && !ReasoningEffortSchema.safeParse(savedEffortRaw).success) {
    return {
      modelId,
      reasoningEffort: null,
      selectionRequired: true,
      selectionError: "reasoning_unsupported",
    };
  }
  const savedEffort = savedEffortRaw as ReasoningEffort | undefined;
  const record = modelId ? records.find((r) => r.id === modelId) : undefined;
  let reasoningEffort: ReasoningEffort | null = null;
  if (record) {
    const v = validateReasoningForModel(savedEffort, record);
    if (!v.ok) {
      return {
        modelId,
        reasoningEffort: null,
        selectionRequired: true,
        selectionError: "reasoning_unsupported",
      };
    }
    reasoningEffort = v.effort;
  }
  return {
    modelId,
    reasoningEffort,
    selectionRequired: !modelId,
    selectionError: modelId ? null : "model_unavailable",
  };
}

export async function saveUserModelPreferences(
  userId: number,
  input: { modelId?: string; reasoningEffort?: string },
): Promise<UserModelPreferences> {
  await ensureUserDefaults(userId);
  const records = await requireRegistry();
  const current = await getUserModelPreferences(userId);
  let modelId = current.modelId;
  if (input.modelId != null) {
    const v = validateUserModelSelection(input.modelId, records);
    if (!v.ok) throw new Error(v.error);
    modelId = v.record.id;
  }
  if (!modelId) throw new Error("model_selection_required");
  const record = records.find((r) => r.id === modelId);
  if (!record) throw new Error("model_unavailable");

  let reasoningEffort = current.reasoningEffort;
  if (input.reasoningEffort != null || input.modelId != null) {
    const v = validateReasoningForModel(
      input.reasoningEffort ?? (input.modelId != null ? undefined : reasoningEffort ?? undefined),
      record,
    );
    if (!v.ok) throw new Error(v.error);
    reasoningEffort = v.effort;
  }

  await execute(
    `UPDATE trading_settings
        SET preferred_model = ?,
            preferred_reasoning_effort = ?,
            updated_at = datetime('now')
      WHERE user_id = ?`,
    [modelId, reasoningEffort, userId],
  );
  return {
    modelId,
    reasoningEffort,
    selectionRequired: false,
    selectionError: null,
  };
}
