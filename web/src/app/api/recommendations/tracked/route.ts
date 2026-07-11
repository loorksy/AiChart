import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import {
  createTrackedRecommendation,
  listTrackedRecommendations,
} from "@/lib/recommendations/recommendationStore";

const createSchema = z.object({
  symbol: z.string().max(32),
  interval: z.string().max(16),
  direction: z.enum(["buy", "sell"]),
  entryType: z.enum(["market", "limit", "pending"]).default("market"),
  entry: z.number(),
  stopLoss: z.number(),
  targets: z.array(z.number()).max(3).default([]),
  invalidationLevel: z.number().optional(),
  setupType: z.string().max(48).optional(),
  rr: z.number().optional(),
  chatId: z.string().max(64).optional(),
  analysisId: z.string().max(64).optional(),
  createdCandleTime: z.number().optional(),
  expiresAt: z.number().optional(),
  priceAtCreation: z.number().optional(),
});

function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `rec-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

/** List the current user's tracked recommendations (most recent first). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 500);
    const recommendations = await listTrackedRecommendations(user.id, {
      limit: Number.isFinite(limit) ? limit : 500,
    });
    return NextResponse.json({ recommendations });
  } catch (err) {
    return handleError(err);
  }
}

/** Create a tracked recommendation (monitoring only — never executes a trade). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = createSchema.parse(await req.json());
    const now = Date.now();
    const rec = await createTrackedRecommendation({
      id: uuid(),
      userId: user.id,
      chatId: body.chatId,
      analysisId: body.analysisId,
      symbol: body.symbol,
      interval: body.interval,
      direction: body.direction,
      entryType: body.entryType,
      entry: body.entry,
      stopLoss: body.stopLoss,
      targets: body.targets,
      invalidationLevel: body.invalidationLevel,
      status: body.entryType === "market" ? "triggered" : "pending_entry",
      outcome: "pending",
      setupType: body.setupType,
      rr: body.rr,
      createdAt: now,
      createdCandleTime: body.createdCandleTime ?? now,
      expiresAt: body.expiresAt ?? now + 4 * 60 * 60 * 1000,
      triggeredAt: body.entryType === "market" ? now : undefined,
      priceAtCreation: body.priceAtCreation,
    });
    return NextResponse.json({ recommendation: rec }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
