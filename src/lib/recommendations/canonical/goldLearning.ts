import { execute, insertReturningId, query, queryOne } from "@/lib/db";

export const GOLD_LEARNING_MIN_SAMPLE_SIZE = 20;
export const GOLD_LEARNING_MIN_CONFIDENCE = 0.7;
export const GOLD_LEARNING_DEFAULT_DECAY = 0.98;

export type GoldWeightVersionStatus = "candidate" | "active" | "rolled_back";

export interface GoldWeightVersion {
  id: number;
  userId: number;
  strategyId: string;
  version: number;
  parentVersion?: number;
  weights: Record<string, number>;
  sampleSize: number;
  confidence: number;
  decay: number;
  status: GoldWeightVersionStatus;
  evidenceEventIds: string[];
  createdAt: number;
  activatedAt?: number;
  rolledBackAt?: number;
}

interface VersionRow {
  id: number;
  user_id: number;
  strategy_id: string;
  version: number;
  parent_version: number | null;
  weights_json: string;
  sample_size: number;
  confidence: number;
  decay: number;
  status: GoldWeightVersionStatus;
  evidence_event_ids_json: string;
  created_at: number;
  activated_at: number | null;
  rolled_back_at: number | null;
}

interface EvidenceRow {
  event_id: string;
  event_type: "RecommendationSucceeded" | "RecommendationFailed";
  evidence_json: string;
}

function object(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function weights(raw: string): Record<string, number> {
  return Object.fromEntries(
    Object.entries(object(raw)).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function strings(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function toVersion(row: VersionRow): GoldWeightVersion {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    strategyId: row.strategy_id,
    version: Number(row.version),
    parentVersion: row.parent_version == null ? undefined : Number(row.parent_version),
    weights: weights(row.weights_json),
    sampleSize: Number(row.sample_size),
    confidence: Number(row.confidence),
    decay: Number(row.decay),
    status: row.status,
    evidenceEventIds: strings(row.evidence_event_ids_json),
    createdAt: Number(row.created_at),
    activatedAt: row.activated_at == null ? undefined : Number(row.activated_at),
    rolledBackAt: row.rolled_back_at == null ? undefined : Number(row.rolled_back_at),
  };
}

interface ValidatedEvidence {
  advisorVotes: Array<{ advisor: string; vote: "buy" | "sell" | "hold" }>;
  direction: "buy" | "sell";
}

function validatedEvidence(raw: string): ValidatedEvidence | null {
  const value = object(raw);
  const validation = value.validation;
  const validated =
    value.validated === true ||
    (validation &&
      typeof validation === "object" &&
      (validation as Record<string, unknown>).status === "validated");
  if (!validated || (value.direction !== "buy" && value.direction !== "sell")) return null;
  const advisorVotes = Array.isArray(value.advisorVotes)
    ? value.advisorVotes.filter((vote): vote is ValidatedEvidence["advisorVotes"][number] => {
        if (!vote || typeof vote !== "object") return false;
        const item = vote as Record<string, unknown>;
        return (
          typeof item.advisor === "string" &&
          (item.vote === "buy" || item.vote === "sell" || item.vote === "hold")
        );
      })
    : [];
  return { advisorVotes, direction: value.direction };
}

export async function proposeGoldWeightVersion(input: {
  userId: number;
  strategyId: string;
  currentWeights: Record<string, number>;
  minSampleSize?: number;
  minConfidence?: number;
  decay?: number;
}): Promise<GoldWeightVersion | null> {
  const rows = await query<EvidenceRow>(
    `SELECT e.event_id, e.event_type, e.evidence_json
       FROM recommendation_learning_events e
       JOIN recommendations r ON r.id = e.recommendation_id AND r.user_id = e.user_id
      WHERE e.user_id = ?
        AND e.event_type IN ('RecommendationSucceeded','RecommendationFailed')
      ORDER BY e.occurred_at ASC, e.event_id ASC`,
    [input.userId],
  );
  const evidence = rows.flatMap((row) => {
    const validated = validatedEvidence(row.evidence_json);
    return validated ? [{ row, validated }] : [];
  });
  const minSampleSize = input.minSampleSize ?? GOLD_LEARNING_MIN_SAMPLE_SIZE;
  if (evidence.length < minSampleSize) return null;
  const successCount = evidence.filter(
    (item) => item.row.event_type === "RecommendationSucceeded",
  ).length;
  const confidence = Math.max(successCount, evidence.length - successCount) / evidence.length;
  if (confidence < (input.minConfidence ?? GOLD_LEARNING_MIN_CONFIDENCE)) return null;

  const decay = input.decay ?? GOLD_LEARNING_DEFAULT_DECAY;
  const advisor = new Map<string, { correct: number; total: number }>();
  for (const item of evidence) {
    const won = item.row.event_type === "RecommendationSucceeded";
    for (const vote of item.validated.advisorVotes) {
      if (vote.vote === "hold") continue;
      const stats = advisor.get(vote.advisor) ?? { correct: 0, total: 0 };
      const aligned = vote.vote === item.validated.direction;
      stats.total += 1;
      stats.correct += won ? Number(aligned) : Number(!aligned);
      advisor.set(vote.advisor, stats);
    }
  }
  const nextWeights = { ...input.currentWeights };
  for (const [name, stats] of advisor) {
    if (stats.total < minSampleSize) continue;
    const accuracy = stats.correct / stats.total;
    const current = nextWeights[name] ?? 1;
    const learned = current * (1 + (accuracy - 0.5) * 0.2);
    nextWeights[name] = Math.max(0.3, Math.min(2, current * decay + learned * (1 - decay)));
  }

  const previous = await queryOne<VersionRow>(
    `SELECT * FROM gold_agent_weight_versions
      WHERE user_id = ? AND strategy_id = ? ORDER BY version DESC LIMIT 1`,
    [input.userId, input.strategyId],
  );
  const version = Number(previous?.version ?? 0) + 1;
  const id = await insertReturningId(
    `INSERT INTO gold_agent_weight_versions
      (user_id, strategy_id, version, parent_version, weights_json, sample_size,
       confidence, decay, status, evidence_event_ids_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.userId,
      input.strategyId,
      version,
      previous?.version ?? null,
      JSON.stringify(nextWeights),
      evidence.length,
      confidence,
      decay,
      "candidate",
      JSON.stringify(evidence.map((item) => item.row.event_id).slice(-500)),
      Date.now(),
    ],
  );
  const created = await queryOne<VersionRow>(
    "SELECT * FROM gold_agent_weight_versions WHERE id = ? AND user_id = ?",
    [id, input.userId],
  );
  return created ? toVersion(created) : null;
}

export async function activateGoldWeightVersion(
  userId: number,
  strategyId: string,
  version: number,
): Promise<GoldWeightVersion | null> {
  const candidate = await queryOne<VersionRow>(
    `SELECT * FROM gold_agent_weight_versions
      WHERE user_id = ? AND strategy_id = ? AND version = ?`,
    [userId, strategyId, version],
  );
  if (!candidate || candidate.status !== "candidate") return candidate ? toVersion(candidate) : null;
  if (
    Number(candidate.sample_size) < GOLD_LEARNING_MIN_SAMPLE_SIZE ||
    Number(candidate.confidence) < GOLD_LEARNING_MIN_CONFIDENCE
  ) return toVersion(candidate);
  const now = Date.now();
  await execute(
    `UPDATE gold_agent_weight_versions SET status = 'rolled_back', rolled_back_at = ?
      WHERE user_id = ? AND strategy_id = ? AND status = 'active'`,
    [now, userId, strategyId],
  );
  await execute(
    `UPDATE gold_agent_weight_versions SET status = 'active', activated_at = ?
      WHERE user_id = ? AND strategy_id = ? AND version = ? AND status = 'candidate'`,
    [now, userId, strategyId, version],
  );
  const active = await queryOne<VersionRow>(
    `SELECT * FROM gold_agent_weight_versions
      WHERE user_id = ? AND strategy_id = ? AND version = ?`,
    [userId, strategyId, version],
  );
  return active ? toVersion(active) : null;
}

export async function rollbackGoldWeightVersion(
  userId: number,
  strategyId: string,
  targetVersion: number,
): Promise<GoldWeightVersion | null> {
  const target = await queryOne<VersionRow>(
    `SELECT * FROM gold_agent_weight_versions
      WHERE user_id = ? AND strategy_id = ? AND version = ?`,
    [userId, strategyId, targetVersion],
  );
  if (!target) return null;
  const now = Date.now();
  await execute(
    `UPDATE gold_agent_weight_versions SET status = 'rolled_back', rolled_back_at = ?
      WHERE user_id = ? AND strategy_id = ? AND status = 'active'`,
    [now, userId, strategyId],
  );
  await execute(
    `UPDATE gold_agent_weight_versions SET status = 'active', activated_at = ?, rolled_back_at = NULL
      WHERE user_id = ? AND strategy_id = ? AND version = ?`,
    [now, userId, strategyId, targetVersion],
  );
  const restored = await queryOne<VersionRow>(
    `SELECT * FROM gold_agent_weight_versions
      WHERE user_id = ? AND strategy_id = ? AND version = ?`,
    [userId, strategyId, targetVersion],
  );
  return restored ? toVersion(restored) : null;
}

export async function listGoldWeightVersions(
  userId: number,
  strategyId: string,
): Promise<GoldWeightVersion[]> {
  const rows = await query<VersionRow>(
    `SELECT * FROM gold_agent_weight_versions
      WHERE user_id = ? AND strategy_id = ? ORDER BY version ASC`,
    [userId, strategyId],
  );
  return rows.map(toVersion);
}
