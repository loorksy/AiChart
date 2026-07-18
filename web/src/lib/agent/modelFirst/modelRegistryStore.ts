import { execute, queryOne } from "@/lib/db";
import { z } from "zod";
import {
  ModelCapabilityRecordSchema,
  getCachedModelRegistry,
  isAllowlistedModelId,
  setCachedModelRegistry,
  type ModelCapabilityRecord,
} from "./modelRegistry";

const REGISTRY_FLAG_KEY = "openai_trading_model_registry_v1";
export const MODEL_REGISTRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const PersistedRegistrySchema = z.object({
  version: z.literal(1),
  savedAt: z.number().int().positive(),
  records: z.array(ModelCapabilityRecordSchema).max(20),
});

/** Load only durable, recently probed provider records. Never invent a model. */
export async function loadModelRegistry(): Promise<ModelCapabilityRecord[] | null> {
  const cached = getCachedModelRegistry();
  if (cached?.length) return cached;

  const row = await queryOne<{ value: string }>(
    "SELECT value FROM system_flags WHERE key = ?",
    [REGISTRY_FLAG_KEY],
  ).catch(() => null);
  if (!row?.value) return null;

  try {
    const parsed = PersistedRegistrySchema.safeParse(JSON.parse(row.value));
    if (!parsed.success) return null;
    if (Date.now() - parsed.data.savedAt > MODEL_REGISTRY_MAX_AGE_MS) return null;
    const records = parsed.data.records.filter((record) =>
      isAllowlistedModelId(record.id),
    );
    if (!records.length) return null;
    setCachedModelRegistry(records);
    return records;
  } catch {
    return null;
  }
}

/** Persist non-secret capability metadata so restarts cannot create fake availability. */
export async function persistModelRegistry(
  records: ModelCapabilityRecord[],
): Promise<void> {
  const safeRecords = records
    .filter((record) => isAllowlistedModelId(record.id))
    .slice(0, 20);
  const payload = PersistedRegistrySchema.parse({
    version: 1,
    savedAt: Date.now(),
    records: safeRecords,
  });
  await execute(
    `INSERT INTO system_flags (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [REGISTRY_FLAG_KEY, JSON.stringify(payload)],
  );
  setCachedModelRegistry(safeRecords);
}
