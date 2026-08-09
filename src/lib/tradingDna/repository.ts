import { randomUUID } from "node:crypto";
import { execute, query, queryOne, transaction } from "@/lib/db";
import { normalizeEvidence, requireEvidence } from "./evidence";
import { deriveTradingPersona } from "./persona";
import type {
  EvidenceReferences,
  ShadowRecommendation,
  TradingDnaConclusion,
  TradingDnaMetric,
  TradingDnaSnapshot,
  TradingPersonaName,
  TradingPersonaVersion,
} from "./types";

interface SnapshotRow {
  snapshot_id: string;
  user_id: number;
  version: number;
  generated_at: number;
  window_start: number | null;
  window_end: number | null;
  sample_size: number;
  metrics_json: string;
  conclusions_json: string;
  evidence_json: string;
}

interface PersonaRow {
  persona_id: string;
  user_id: number;
  version: number;
  snapshot_id: string;
  persona: TradingPersonaName;
  confidence: number;
  sample_size: number;
  rationale: string;
  evidence_json: string;
  created_at: number;
}

interface ShadowRow {
  shadow_recommendation_id: string;
  user_id: number;
  snapshot_id: string;
  source_recommendation_id: number | null;
  symbol: string;
  timeframe: string;
  direction: ShadowRecommendation["direction"];
  confidence: number;
  rationale_json: string;
  evidence_json: string;
  research_only: number | boolean;
  execution_prohibited: number | boolean;
  created_at: number;
}

function json<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toSnapshot(row: SnapshotRow): TradingDnaSnapshot {
  return {
    snapshotId: row.snapshot_id,
    userId: Number(row.user_id),
    version: Number(row.version),
    generatedAt: Number(row.generated_at),
    windowStart: row.window_start == null ? undefined : Number(row.window_start),
    windowEnd: row.window_end == null ? undefined : Number(row.window_end),
    sampleSize: Number(row.sample_size),
    metrics: json<TradingDnaMetric[]>(row.metrics_json, []),
    conclusions: json<TradingDnaConclusion[]>(row.conclusions_json, []),
    evidence: normalizeEvidence(json<Partial<EvidenceReferences>>(row.evidence_json, {})),
  };
}

function toPersona(row: PersonaRow): TradingPersonaVersion {
  return {
    personaId: row.persona_id,
    userId: Number(row.user_id),
    version: Number(row.version),
    snapshotId: row.snapshot_id,
    persona: row.persona,
    confidence: Number(row.confidence),
    sampleSize: Number(row.sample_size),
    rationale: row.rationale,
    evidence: normalizeEvidence(json<Partial<EvidenceReferences>>(row.evidence_json, {})),
    createdAt: Number(row.created_at),
  };
}

function toShadow(row: ShadowRow): ShadowRecommendation {
  if (!row.research_only || !row.execution_prohibited) {
    throw new Error("Invalid executable shadow recommendation record");
  }
  return {
    shadowRecommendationId: row.shadow_recommendation_id,
    userId: Number(row.user_id),
    snapshotId: row.snapshot_id,
    sourceRecommendationId:
      row.source_recommendation_id == null ? undefined : Number(row.source_recommendation_id),
    symbol: row.symbol,
    timeframe: row.timeframe,
    direction: row.direction,
    confidence: Number(row.confidence),
    rationale: json<string[]>(row.rationale_json, []),
    evidence: normalizeEvidence(json<Partial<EvidenceReferences>>(row.evidence_json, {})),
    researchOnly: true,
    executionProhibited: true,
    createdAt: Number(row.created_at),
  };
}

export async function persistTradingDnaSnapshot(input: {
  userId: number;
  generatedAt?: number;
  windowStart?: number;
  windowEnd?: number;
  sampleSize: number;
  metrics: TradingDnaMetric[];
  conclusions: TradingDnaConclusion[];
  evidence: EvidenceReferences;
}): Promise<{ snapshot: TradingDnaSnapshot; persona: TradingPersonaVersion }> {
  if (!Number.isInteger(input.userId) || input.userId <= 0) throw new Error("Invalid Trading DNA tenant");
  for (const conclusion of input.conclusions) requireEvidence(conclusion.evidence, conclusion.id);
  const snapshotId = `dna_${randomUUID()}`;
  const personaId = `persona_${randomUUID()}`;
  const generatedAt = input.generatedAt ?? Date.now();
  return transaction(async (tx) => {
    const versionRows = await tx.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0) AS version FROM trading_dna_snapshots WHERE user_id = ?",
      [input.userId],
    );
    const version = Number(versionRows[0]?.version ?? 0) + 1;
    const snapshot: TradingDnaSnapshot = {
      snapshotId,
      userId: input.userId,
      version,
      generatedAt,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      sampleSize: input.sampleSize,
      metrics: input.metrics,
      conclusions: input.conclusions,
      evidence: normalizeEvidence(input.evidence),
    };
    await tx.execute(
      `INSERT INTO trading_dna_snapshots
        (snapshot_id, user_id, version, generated_at, window_start, window_end,
         sample_size, metrics_json, conclusions_json, evidence_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        snapshot.snapshotId,
        snapshot.userId,
        snapshot.version,
        snapshot.generatedAt,
        snapshot.windowStart ?? null,
        snapshot.windowEnd ?? null,
        snapshot.sampleSize,
        JSON.stringify(snapshot.metrics),
        JSON.stringify(snapshot.conclusions),
        JSON.stringify(snapshot.evidence),
      ],
    );
    const personaVersionRows = await tx.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0) AS version FROM trading_persona_versions WHERE user_id = ?",
      [input.userId],
    );
    const persona = deriveTradingPersona(snapshot, {
      personaId,
      version: Number(personaVersionRows[0]?.version ?? 0) + 1,
      createdAt: generatedAt,
    });
    await tx.execute(
      `INSERT INTO trading_persona_versions
        (persona_id, user_id, version, snapshot_id, persona, confidence,
         sample_size, rationale, evidence_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        persona.personaId,
        persona.userId,
        persona.version,
        persona.snapshotId,
        persona.persona,
        persona.confidence,
        persona.sampleSize,
        persona.rationale,
        JSON.stringify(persona.evidence),
        persona.createdAt,
      ],
    );
    return { snapshot, persona };
  });
}

export async function getTradingDnaSnapshot(
  userId: number,
  snapshotId: string,
): Promise<TradingDnaSnapshot | null> {
  const row = await queryOne<SnapshotRow>(
    "SELECT * FROM trading_dna_snapshots WHERE snapshot_id = ? AND user_id = ?",
    [snapshotId, userId],
  );
  return row ? toSnapshot(row) : null;
}

export async function getLatestTradingDnaSnapshot(userId: number): Promise<TradingDnaSnapshot | null> {
  const row = await queryOne<SnapshotRow>(
    "SELECT * FROM trading_dna_snapshots WHERE user_id = ? ORDER BY version DESC LIMIT 1",
    [userId],
  );
  return row ? toSnapshot(row) : null;
}

export async function listTradingDnaSnapshots(
  userId: number,
  limit = 100,
): Promise<TradingDnaSnapshot[]> {
  const rows = await query<SnapshotRow>(
    "SELECT * FROM trading_dna_snapshots WHERE user_id = ? ORDER BY version ASC LIMIT ?",
    [userId, Math.max(1, Math.min(limit, 500))],
  );
  return rows.map(toSnapshot);
}

export async function getPersonaForSnapshot(
  userId: number,
  snapshotId: string,
): Promise<TradingPersonaVersion | null> {
  const row = await queryOne<PersonaRow>(
    "SELECT * FROM trading_persona_versions WHERE snapshot_id = ? AND user_id = ?",
    [snapshotId, userId],
  );
  return row ? toPersona(row) : null;
}

export async function getLatestTradingPersona(userId: number): Promise<TradingPersonaVersion | null> {
  const row = await queryOne<PersonaRow>(
    "SELECT * FROM trading_persona_versions WHERE user_id = ? ORDER BY version DESC LIMIT 1",
    [userId],
  );
  return row ? toPersona(row) : null;
}

export async function persistShadowRecommendation(
  input: Omit<ShadowRecommendation, "shadowRecommendationId" | "researchOnly" | "executionProhibited">,
): Promise<ShadowRecommendation> {
  requireEvidence(input.evidence, "Shadow recommendation");
  const ownedSnapshot = await queryOne<{ snapshot_id: string }>(
    "SELECT snapshot_id FROM trading_dna_snapshots WHERE snapshot_id = ? AND user_id = ?",
    [input.snapshotId, input.userId],
  );
  if (!ownedSnapshot) throw new Error("Shadow recommendation snapshot does not belong to this tenant");
  if (input.sourceRecommendationId != null) {
    const ownedRecommendation = await queryOne<{ id: number }>(
      "SELECT id FROM recommendations WHERE id = ? AND user_id = ?",
      [input.sourceRecommendationId, input.userId],
    );
    if (!ownedRecommendation) {
      throw new Error("Shadow recommendation source does not belong to this tenant");
    }
  }
  const shadow: ShadowRecommendation = {
    ...input,
    shadowRecommendationId: `shadow_${randomUUID()}`,
    evidence: normalizeEvidence(input.evidence),
    researchOnly: true,
    executionProhibited: true,
  };
  await execute(
    `INSERT INTO shadow_recommendations
      (shadow_recommendation_id, user_id, snapshot_id, source_recommendation_id,
       symbol, timeframe, direction, confidence, rationale_json, evidence_json,
       research_only, execution_prohibited, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      shadow.shadowRecommendationId,
      shadow.userId,
      shadow.snapshotId,
      shadow.sourceRecommendationId ?? null,
      shadow.symbol,
      shadow.timeframe,
      shadow.direction,
      shadow.confidence,
      JSON.stringify(shadow.rationale),
      JSON.stringify(shadow.evidence),
      1,
      1,
      shadow.createdAt,
    ],
  );
  return shadow;
}

export async function getShadowRecommendation(
  userId: number,
  shadowRecommendationId: string,
): Promise<ShadowRecommendation | null> {
  const row = await queryOne<ShadowRow>(
    "SELECT * FROM shadow_recommendations WHERE shadow_recommendation_id = ? AND user_id = ?",
    [shadowRecommendationId, userId],
  );
  return row ? toShadow(row) : null;
}

export async function listShadowRecommendations(
  userId: number,
  limit = 100,
): Promise<ShadowRecommendation[]> {
  const rows = await query<ShadowRow>(
    "SELECT * FROM shadow_recommendations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, Math.max(1, Math.min(limit, 500))],
  );
  return rows.map(toShadow);
}
