import { getDbBackend, execute, insertReturningId, query, queryOne } from "./db";
import { createEmbedding } from "./embeddings";
import type { SemanticMemory } from "./types";

export const MEMORY_SCORE_THRESHOLD = 0.70;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as number[];
    return Array.isArray(arr) && arr.length > 0 ? arr : null;
  } catch {
    return null;
  }
}

function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export interface InsertSemanticMemoryInput {
  userId: number;
  category: string; // 'conversation_summary', 'conversation_full', 'user_preference', 'strategy_discussion', 'portfolio_context'
  content: string;
  conversationId?: number | null;
  embedding?: number[];
  source?: string;
  memoryType?: string;
  confidence?: number;
  safetyClassification?: string;
  expiresAt?: Date | string | null;
  sourceChatId?: string | null;
  sourceMessageId?: string | null;
  sourceRecommendationId?: string | null;
  sourceTradeId?: string | null;
  locale?: "ar" | "en" | null;
  symbol?: string | null;
  timeframe?: string | null;
  strategyId?: string | null;
}

export async function insertSemanticMemory(
  input: InsertSemanticMemoryInput,
): Promise<SemanticMemory> {
  const backend = getDbBackend();
  let embedding = input.embedding;
  if (!embedding) {
    try {
      embedding = await createEmbedding(input.content);
    } catch (err) {
      console.error("[semanticMemory] Failed to create embedding for memory content:", err);
      embedding = [];
    }
  }

  if (backend === "postgres") {
    const id = await insertReturningId(
      `INSERT INTO semantic_memories
         (user_id, conversation_id, category, content, embedding, archived,
          source, memory_type, confidence, safety_classification, expires_at,
          source_chat_id, source_message_id, source_recommendation_id, source_trade_id,
          locale, symbol, timeframe, strategy_id)
       VALUES (?, ?, ?, ?, ?::vector, FALSE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.conversationId ?? null,
        input.category,
        input.content,
        embedding.length > 0 ? vectorLiteral(embedding) : null,
        input.source ?? "agent",
        input.memoryType ?? input.category,
        Math.max(0, Math.min(input.confidence ?? 0.8, 1)),
        input.safetyClassification ?? "untrusted_content",
        input.expiresAt instanceof Date ? input.expiresAt.toISOString() : input.expiresAt ?? null,
        input.sourceChatId ?? null,
        input.sourceMessageId ?? null,
        input.sourceRecommendationId ?? null,
        input.sourceTradeId ?? null,
        input.locale ?? null,
        input.symbol?.toUpperCase() ?? null,
        input.timeframe?.toLowerCase() ?? null,
        input.strategyId ?? null,
      ],
    );
    return (await queryOne<SemanticMemory>(
      "SELECT * FROM semantic_memories WHERE id = ?",
      [id],
    ))!;
  }

  const id = await insertReturningId(
    `INSERT INTO semantic_memories
       (user_id, conversation_id, category, content, embedding_json, archived,
        source, memory_type, confidence, safety_classification, expires_at,
        source_chat_id, source_message_id, source_recommendation_id, source_trade_id,
        locale, symbol, timeframe, strategy_id)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.conversationId ?? null,
      input.category,
      input.content,
      embedding.length > 0 ? JSON.stringify(embedding) : null,
      input.source ?? "agent",
      input.memoryType ?? input.category,
      Math.max(0, Math.min(input.confidence ?? 0.8, 1)),
      input.safetyClassification ?? "untrusted_content",
      input.expiresAt instanceof Date ? input.expiresAt.toISOString() : input.expiresAt ?? null,
      input.sourceChatId ?? null,
      input.sourceMessageId ?? null,
      input.sourceRecommendationId ?? null,
      input.sourceTradeId ?? null,
      input.locale ?? null,
      input.symbol?.toUpperCase() ?? null,
      input.timeframe?.toLowerCase() ?? null,
      input.strategyId ?? null,
    ],
  );
  return (await queryOne<SemanticMemory>(
    "SELECT * FROM semantic_memories WHERE id = ?",
    [id],
  ))!;
}

export async function archiveSemanticMemory(
  id: number,
  userId?: number,
): Promise<boolean> {
  const backend = getDbBackend();
  const userClause = userId != null ? " AND user_id = ?" : "";
  const params = userId != null ? [id, userId] : [id];
  if (backend === "postgres") {
    const res = await execute(
      `UPDATE semantic_memories SET archived = TRUE, updated_at = NOW() WHERE id = ?${userClause}`,
      params,
    );
    return res.changes > 0;
  }
  const res = await execute(
    `UPDATE semantic_memories SET archived = 1, updated_at = datetime('now') WHERE id = ?${userClause}`,
    params,
  );
  return res.changes > 0;
}

export interface SearchSemanticMemoryMatch extends SemanticMemory {
  score: number;
}

export async function searchSemanticMemories(
  userId: number,
  queryText: string,
  category?: string,
  limit = 3,
  minScore = MEMORY_SCORE_THRESHOLD,
): Promise<SearchSemanticMemoryMatch[]> {
  if (!queryText.trim()) return [];
  
  let queryVec: number[];
  try {
    queryVec = await createEmbedding(queryText);
  } catch (err) {
    console.error("[semanticMemory] Failed to create embedding for query:", err);
    return searchSemanticMemoriesByKeyword(userId, queryText, category, limit);
  }

  const backend = getDbBackend();

  if (backend === "postgres") {
    // Dynamic vector dimension matching: pgvector <=> operator computes distance between vectors of any matching dimension.
    const querySql = category
      ? `SELECT *, (1 - (embedding <=> ?::vector)) AS score
         FROM semantic_memories
         WHERE user_id = ? AND category = ? AND archived = FALSE AND embedding IS NOT NULL
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY embedding <=> ?::vector
         LIMIT ?`
      : `SELECT *, (1 - (embedding <=> ?::vector)) AS score
         FROM semantic_memories
         WHERE user_id = ? AND archived = FALSE AND embedding IS NOT NULL
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY embedding <=> ?::vector
         LIMIT ?`;

    const params = category
      ? [vectorLiteral(queryVec), userId, category, vectorLiteral(queryVec), limit]
      : [vectorLiteral(queryVec), userId, vectorLiteral(queryVec), limit];

    const rows = await query<SearchSemanticMemoryMatch>(querySql, params);
    return rows.filter((r) => r.score >= minScore);
  }

  // SQLite fallback: Cosine Similarity computed in memory
  const querySql = category
    ? "SELECT * FROM semantic_memories WHERE user_id = ? AND category = ? AND archived = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))"
    : "SELECT * FROM semantic_memories WHERE user_id = ? AND archived = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))";
  const params = category ? [userId, category] : [userId];

  const rows = await query<SemanticMemory>(querySql, params);
  const scored: SearchSemanticMemoryMatch[] = [];

  for (const row of rows) {
    const vec = parseEmbedding(row.embedding_json);
    if (!vec || vec.length !== queryVec.length) continue; // Ensures same dimension matches
    const score = cosineSimilarity(queryVec, vec);
    if (score >= minScore) {
      scored.push({
        ...row,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function searchSemanticMemoriesByKeyword(
  userId: number,
  queryText: string,
  category: string | undefined,
  limit: number,
): Promise<SearchSemanticMemoryMatch[]> {
  const terms = [...new Set(queryText.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])].slice(0, 8);
  if (!terms.length) return [];
  const backend = getDbBackend();
  const expiry = backend === "postgres"
    ? "(expires_at IS NULL OR expires_at > NOW())"
    : "(expires_at IS NULL OR expires_at > datetime('now'))";
  const categoryClause = category ? " AND category = ?" : "";
  const params = category ? [userId, category] : [userId];
  const rows = await query<SemanticMemory>(
    `SELECT * FROM semantic_memories WHERE user_id = ?${categoryClause}
       AND archived = ${backend === "postgres" ? "FALSE" : "0"} AND ${expiry}
       ORDER BY updated_at DESC, id DESC LIMIT 200`,
    params,
  );
  return rows
    .map((row) => {
      const haystack = row.content.toLocaleLowerCase();
      const matches = terms.filter((term) => haystack.includes(term)).length;
      return { ...row, score: matches / terms.length };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || Number(b.confidence ?? 0) - Number(a.confidence ?? 0))
    .slice(0, limit);
}

export async function markSemanticMemoriesUsed(userId: number, ids: number[]): Promise<void> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return;
  const now = getDbBackend() === "postgres" ? "NOW()" : "datetime('now')";
  for (const id of unique) {
    await execute(
      `UPDATE semantic_memories SET last_used_at = ${now}, use_count = COALESCE(use_count, 0) + 1 WHERE id = ? AND user_id = ?`,
      [id, userId],
    );
  }
}
