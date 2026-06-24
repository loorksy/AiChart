import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { runBotTickForUser } from "@/lib/botEngine";
import { createBotSession, getBotSession, listUserBots } from "@/lib/botStore";
import { botsLiveEnabled } from "@/lib/botExecution";
import { GOLD_SYMBOL } from "@/lib/strategies/gold/goldDefaults";

export const dynamic = "force-dynamic";

const GOLD_SYMBOL_RE = /^XAUUSD(M)?$/i;

const gridConfigSchema = z.object({
  initialLot: z.number().positive().max(100),
  gridStep: z.number().positive(),
  multiplier: z.number().min(1).max(3),
  takeProfit: z.number().positive(),
  maxLevels: z.number().int().min(1).max(20),
  maxTotalLot: z.number().positive().max(1000),
  lotStep: z.number().positive().optional(),
});

const goldConfigSchema = z.object({
  initialLot: z.number().positive().max(100),
  gridStepPips: z.number().positive().max(5000),
  takeProfitPips: z.number().positive().max(5000),
  multiplier: z.number().min(1).max(3),
  maxLevels: z.number().int().min(1).max(20),
  maxTotalLot: z.number().positive().max(1000),
  maxLotCap: z.number().positive().max(100),
  candleTimeframe: z.enum(["M5", "M15", "H1"]),
  maxEquityDrawdownPct: z.number().min(1).max(50).default(20),
  lotStep: z.number().positive().optional(),
});

const gridSchema = z.object({
  strategy: z.literal("grid").default("grid"),
  symbol: z.string().min(2).max(20),
  market: z.enum(["crypto", "forex"]).default("forex"),
  side: z.enum(["buy", "sell"]),
  executionMode: z.enum(["paper", "live"]).default("live"),
  config: gridConfigSchema,
});

const goldSchema = z.object({
  strategy: z.literal("gold"),
  symbol: z.string().min(2).max(20).optional(),
  market: z.literal("forex").default("forex"),
  side: z.enum(["buy", "sell"]).optional(),
  executionMode: z.enum(["paper", "live"]).default("live"),
  config: goldConfigSchema,
});

const schema = z.discriminatedUnion("strategy", [gridSchema, goldSchema]);

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    return NextResponse.json({
      bots: await listUserBots(user.id),
      meta: { liveEnabled: botsLiveEnabled() },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const raw = await req.json();
    const input = schema.parse({
      strategy: "grid",
      ...(typeof raw === "object" && raw !== null ? raw : {}),
    });

    if (input.strategy === "gold") {
      const sym = (input.symbol ?? GOLD_SYMBOL).toUpperCase();
      if (!GOLD_SYMBOL_RE.test(sym)) {
        return NextResponse.json(
          { error: "بوت الذهب يعمل على XAUUSD فقط." },
          { status: 400 },
        );
      }
      const side = input.side ?? "buy";
      const bot = await createBotSession(user.id, {
        strategy: "gold",
        symbol: GOLD_SYMBOL,
        market: "forex",
        side,
        executionMode: input.executionMode,
        config: {
          ...input.config,
          ...(input.side ? { side: input.side } : {}),
        },
      });
      const tickEvents = await runBotTickForUser(user.id);
      const fresh = (await getBotSession(bot.id, user.id)) ?? bot;
      return NextResponse.json({ ok: true, bot: fresh, tickEvents });
    }

    const bot = await createBotSession(user.id, {
      strategy: "grid",
      symbol: input.symbol.toUpperCase(),
      market: input.market,
      side: input.side,
      executionMode: input.executionMode,
      config: { side: input.side, ...input.config },
    });
    const tickEvents = await runBotTickForUser(user.id);
    const fresh = (await getBotSession(bot.id, user.id)) ?? bot;
    return NextResponse.json({ ok: true, bot: fresh, tickEvents });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "إعدادات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
