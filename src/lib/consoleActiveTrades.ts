import type { ExecutionEnvSnapshot } from "./executionEnv";

import { getExecutionEnvSnapshot } from "./executionEnv";

import type { Trade } from "./types";

import { getIntent, listOpenTrades, listPendingEntryTrades } from "./store";



export interface ConsoleActiveTradeRow {

  id: string;

  symbol: string;

  platform: string;

  side: string;

  leverage: number | null;

  margin: number | null;

  unrealizedPnl: number | null;

  sl: number | null;

  tp: number | null;

  env: string;

  status: "open" | "pending_entry";

  qty?: number;

  avgPrice?: number;

}



function sideAr(side: string): string {

  return side === "buy" || side === "long" ? "شراء" : "بيع";

}



function platformLabel(_trade: Trade): string {

  return "MT5";

}



async function loadIntentSlTp(

  trades: Trade[],

): Promise<Map<number, { sl: number | null; tp: number | null }>> {

  const map = new Map<number, { sl: number | null; tp: number | null }>();

  const ids = [

    ...new Set(

      trades.map((t) => t.intent_id).filter((id): id is number => id != null),

    ),

  ];

  await Promise.all(

    ids.map(async (id) => {

      const intent = await getIntent(id);

      if (intent) {

        map.set(id, {

          sl: intent.stop_loss ?? null,

          tp: intent.take_profit ?? null,

        });

      }

    }),

  );

  return map;

}



function mapAichartBase(

  trade: Trade,

  slTp: { sl: number | null; tp: number | null } | undefined,

): ConsoleActiveTradeRow {

  const pending = trade.status === "pending_entry";

  return {

    id: `aichart-${trade.id}`,

    symbol: trade.symbol,

    platform: platformLabel(trade),

    side: pending

      ? `${sideAr(trade.side)} · limit`

      : sideAr(trade.side),

    leverage: trade.leverage ?? null,

    margin: trade.quote_qty ?? null,

    unrealizedPnl: null,

    sl: slTp?.sl ?? null,

    tp: slTp?.tp ?? null,

    env: trade.env,

    status: pending ? "pending_entry" : "open",

    qty: trade.qty,

    avgPrice: trade.limit_price ?? trade.avg_price,

  };

}



/** Live active trades for the bridge console (AiChart). */

export async function buildConsoleActiveTrades(userId: number): Promise<{

  rows: ConsoleActiveTradeRow[];

  executionEnv: ExecutionEnvSnapshot;

  aichartTrades: Trade[];

}> {

  const [executionEnv, openTrades, pendingTrades] =

    await Promise.all([

      getExecutionEnvSnapshot(userId),

      listOpenTrades(userId, 30),

      listPendingEntryTrades(userId, 20),

    ]);



  const aichartTrades = [...pendingTrades, ...openTrades];

  const slTpMap = await loadIntentSlTp(aichartTrades);



  const rows: ConsoleActiveTradeRow[] = [];



  for (const trade of aichartTrades) {

    rows.push(

      mapAichartBase(

        trade,

        trade.intent_id != null ? slTpMap.get(trade.intent_id) : undefined,

      ),

    );

  }



  return {

    rows,

    executionEnv,

    aichartTrades,

  };

}



