import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError, ApiError } from "@/lib/api";
import { query } from "@/lib/db";
import { archiveSemanticMemory } from "@/lib/semanticMemory";

/**
 * Memory transparency (docs/PLATFORM_AGENT_UPGRADE_PLAN.md Phase 4): every
 * fact the agent remembers about a user is visible to that user and revocable
 * by them. Owner-scoped reads; deletion archives (the recall path already
 * excludes archived rows) so an audit trail survives without the memory ever
 * being used again.
 */

interface MemoryRow {
  id: number;
  category: string;
  memory_type: string;
  content: string;
  symbol: string | null;
  timeframe: string | null;
  source: string;
  confidence: number;
  created_at: string | number;
}

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const rows = await query<MemoryRow>(
      `SELECT id, category, memory_type, content, symbol, timeframe, source,
              confidence, created_at
         FROM semantic_memories
        WHERE user_id = ? AND archived = 0
        ORDER BY created_at DESC, id DESC
        LIMIT 100`,
      [user.id],
    );
    return NextResponse.json({
      memories: rows.map((row) => ({
        id: Number(row.id),
        category: row.category,
        memoryType: row.memory_type,
        content: row.content,
        symbol: row.symbol,
        timeframe: row.timeframe,
        source: row.source,
        confidence: Number(row.confidence),
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, "A valid memory id is required");
    }
    // Owner-scoped inside the helper — another user's id silently changes nothing.
    const removed = await archiveSemanticMemory(id, user.id);
    if (!removed) throw new ApiError(404, "Memory not found");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
