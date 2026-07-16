import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getEaConnection, isEaOnlineDebounced } from "@/lib/eaStore";
import { getActiveRecommendation } from "@/lib/agent/sessionRecommendation";
import { generateEmptyChatState } from "@/lib/agent/suggestions/generateEmptyChatState";

const querySchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  interval: z.string().trim().min(1).max(16),
  chatId: z.string().trim().min(1).max(120).optional(),
  drawings: z.coerce.number().int().min(0).max(200).default(0),
  locale: z.enum(["ar", "en"]).default("ar"),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const input = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const [connection, activeRecommendation] = await Promise.all([
      getEaConnection(user.id),
      input.chatId
        ? getActiveRecommendation(input.chatId, input.symbol, user.id)
        : Promise.resolve(null),
    ]);
    const state = await generateEmptyChatState({
      locale: input.locale,
      symbol: input.symbol,
      interval: input.interval,
      drawingsCount: input.drawings,
      hasActiveRecommendation: Boolean(activeRecommendation),
      accountConnected: Boolean(
        connection && isEaOnlineDebounced(user.id, connection.last_heartbeat_at),
      ),
    });
    return NextResponse.json(state ?? { greeting: null, suggestions: [] });
  } catch (error) {
    return handleError(error);
  }
}
