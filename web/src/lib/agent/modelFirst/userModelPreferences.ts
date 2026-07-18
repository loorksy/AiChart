/**
 * Per-user model + reasoning preferences (tenant-scoped).
 */
import { execute, queryOne } from "@/lib/db";
import { ensureUserDefaults } from "@/lib/store";
import {
  type ReasoningEffort,
  ReasoningEffortSchema,
  getCachedModelRegistry,
  pickDefaultModelId,
  validateReasoningForModel,
  validateUserModelSelection,
} from "./modelRegistry";
import { stubProbedRegistry } from "./probeModels";

export type UserModelPreferences = {
  modelId: string | null;
  reasoningEffort: ReasoningEffort | null;
};

function registryOrStub() {
  let records = getCachedModelRegistry();
  if (!records?.length) {
    records = stubProbedRegistry(["gpt-4.1", "o3-mini", "o4-mini"]);
  }
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

  const records = registryOrStub();
  const savedModel = row?.preferred_model?.trim() || null;
  let modelId: string | null = null;
  if (savedModel) {
    const v = validateUserModelSelection(savedModel, records);
    modelId = v.ok ? v.record.id : null;
  }
  if (!modelId) modelId = pickDefaultModelId(records);

  const savedEffortRaw = row?.preferred_reasoning_effort?.trim();
  const savedEffort = ReasoningEffortSchema.safeParse(savedEffortRaw).success
    ? (savedEffortRaw as ReasoningEffort)
    : "high";
  const record = modelId ? records.find((r) => r.id === modelId) : undefined;
  let reasoningEffort: ReasoningEffort | null = null;
  if (record) {
    const v = validateReasoningForModel(savedEffort, record);
    reasoningEffort = v.ok ? v.effort : null;
  }
  return { modelId, reasoningEffort };
}

export async function saveUserModelPreferences(
  userId: number,
  input: { modelId?: string; reasoningEffort?: string },
): Promise<UserModelPreferences> {
  await ensureUserDefaults(userId);
  const records = registryOrStub();
  const current = await getUserModelPreferences(userId);
  let modelId = current.modelId;
  if (input.modelId != null) {
    const v = validateUserModelSelection(input.modelId, records);
    if (!v.ok) throw new Error(v.error);
    modelId = v.record.id;
  }
  const record = records.find((r) => r.id === modelId);
  if (!record) throw new Error("model_unavailable");

  let reasoningEffort = current.reasoningEffort;
  if (input.reasoningEffort != null || input.modelId != null) {
    const v = validateReasoningForModel(
      input.reasoningEffort ?? reasoningEffort ?? "high",
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
  return { modelId, reasoningEffort };
}
