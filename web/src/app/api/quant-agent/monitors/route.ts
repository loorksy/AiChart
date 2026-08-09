import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { createMonitor, listMonitors, MONITOR_FIRE_RULES } from "@/lib/quantAgent/monitorStore";

/**
 * Quant Agent "AI Scheduled Monitors" CRUD (plan §A6). Mirrors
 * `api/quant-agent/chat/sessions/route.ts`'s convention: `resolveQuantAgentUserId`
 * → zod `.parse()` → store call → `NextResponse.json`, zod errors handled
 * explicitly before the generic `handleError` catch.
 */

const webhookUrlSchema = z
  .string()
  .trim()
  .url()
  .startsWith("https://", "Webhook URL must use https://.")
  .max(2048);

const createSchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  market: z.string().trim().max(16).optional(),
  interval: z.string().trim().min(1).max(16),
  notifyTelegram: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
  notifyWebhookUrl: z.union([webhookUrlSchema, z.literal(""), z.null()]).optional(),
  // How often the monitor may speak. Optional, defaulting to `always` in the
  // store, so every existing client keeps the behaviour it already had.
  fireRule: z.enum(MONITOR_FIRE_RULES).optional(),
});

/** List the current user's monitors. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const monitors = await listMonitors(userId);
    return NextResponse.json({ monitors });
  } catch (err) {
    return handleError(err);
  }
}

/** Create a new monitor for the current user. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) throw new ApiError(400, marketErr);
    const market = resolveActiveMarket(body.market);
    const monitor = await createMonitor(userId, {
      symbol: body.symbol,
      market,
      interval: body.interval,
      notifyTelegram: body.notifyTelegram,
      notifyPush: body.notifyPush,
      notifyWebhookUrl: body.notifyWebhookUrl || null,
      fireRule: body.fireRule,
    });
    return NextResponse.json({ monitor }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return handleError(err);
  }
}
