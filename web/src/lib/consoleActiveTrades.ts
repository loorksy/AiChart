import type { ExecutionEnvSnapshot } from "./executionEnv";

import { getExecutionEnvSnapshot } from "./executionEnv";

import { loadBrokerMt5Positions } from "./openTradesSummary";

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



function platformLabel(trade: Trade): string {

  if (

    trade.broker === "mt_ea" ||

    trade.broker === "metaapi" ||

    trade.broker === "mt5_local"

  ) {

    return "MT5";

  }

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



function mapMt5Row(p: {

  ticket: number;

  symbol: string;

  side: string;

  lots: number;

  profit: number;

  sl?: number | null;

  tp?: number | null;

}): ConsoleActiveTradeRow {

  return {

    id: `mt5-${p.ticket}`,

    symbol: p.symbol,

    platform: "MT5",

    side: sideAr(p.side),

    leverage: null,

    margin: null,

    unrealizedPnl: p.profit,

    sl: p.sl ?? null,

    tp: p.tp ?? null,

    env: "live",

    status: "open",

    qty: p.lots,

  };

}



/** Live active trades for the bridge console (AiChart + MT5). */

export async function buildConsoleActiveTrades(userId: number): Promise<{

  rows: ConsoleActiveTradeRow[];

  executionEnv: ExecutionEnvSnapshot;

  aichartTrades: Trade[];

  brokerPositions: {

    mt5: Awaited<ReturnType<typeof loadBrokerMt5Positions>>;

  };

}> {

  const [executionEnv, openTrades, pendingTrades, brokerMt5] =

    await Promise.all([

      getExecutionEnvSnapshot(userId),

      listOpenTrades(userId, 30),

      listPendingEntryTrades(userId, 20),

      loadBrokerMt5Positions(userId),

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



  for (const p of brokerMt5) {

    rows.push(mapMt5Row(p));

  }



  return {

    rows,

    executionEnv,

    aichartTrades,

    brokerPositions: { mt5: brokerMt5 },

  };

}



