import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { runBotTickForUser } from "@/lib/botEngine";
import { createBotSession, getBotSession, listUserBots } from "@/lib/botStore";
import { botsLiveEnabled } from "@/lib/botExecution";
import { DEFAULT_GOLD_AGENTX_CONFIG, GOLD_SYMBOL } from "@/lib/strategies/gold/goldDefaults";

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
  maxLot: z.number().positive().max(100).default(DEFAULT_GOLD_AGENTX_CONFIG.maxLot),
  minConfidence: z.number().min(50).max(95).default(60),
  maxEquityDrawdownPct: z.number().min(1).max(50).default(20),
  drawdownTightenPct: z.number().min(5).max(40).default(15),
  survivalDrawdownPct: z.number().min(10).max(50).default(20),
  stopLossAtrMult: z.number().min(0.5).max(5).default(2),
  stopLossPips: z.number().positive().max(5000).default(200),
  entryTimeframe: z.enum(["M5", "M15", "H1"]).default("M15"),
  correlationSymbols: z
    .object({
      dxy: z.array(z.string()).optional(),
      us10y: z.array(z.string()).optional(),
      vix: z.array(z.string()).optional(),
    })
    .optional(),
  optimizerIntervalTrades: z.number().int().min(20).max(200).default(75),
  lotStep: z.number().positive().optional(),
}).transform((cfg) => ({
  ...DEFAULT_GOLD_AGENTX_CONFIG,
  ...cfg,
  baseLot: cfg.initialLot,
  optimizerTradeInterval: cfg.optimizerIntervalTrades,
  correlationSymbols: {
    dxy: cfg.correlationSymbols?.dxy ?? DEFAULT_GOLD_AGENTX_CONFIG.correlationSymbols.dxy,
    us10y: cfg.correlationSymbols?.us10y ?? DEFAULT_GOLD_AGENTX_CONFIG.correlationSymbols.us10y,
    vix: cfg.correlationSymbols?.vix ?? DEFAULT_GOLD_AGENTX_CONFIG.correlationSymbols.vix,
  },
  institutionalWeights: DEFAULT_GOLD_AGENTX_CONFIG.institutionalWeights,
}));

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
        config: input.config,
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
