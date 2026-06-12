import crypto from "crypto";
import type { BinanceEnv } from "./binance";

// USDT-M Futures hosts. Testnet futures has its own host (separate from
// spot testnet) — keys are issued from https://testnet.binancefuture.com.
const FUTURES_BASE_URLS: Record<BinanceEnv, string> = {
  testnet: "https://testnet.binancefuture.com",
  prod: "https://fapi.binance.com",
};

function sign(query: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function futuresRequest(
  method: "GET" | "POST" | "DELETE",
  endpoint: string,
  params: Record<string, string | number | boolean>,
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
): Promise<unknown> {
  const base = FUTURES_BASE_URLS[env];
  const query = Object.entries({
    ...params,
    timestamp: Date.now(),
    recvWindow: 10000,
  })
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const signature = sign(query, apiSecret);
  const url = `${base}${endpoint}?${query}&signature=${signature}`;
  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": apiKey },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "msg" in body
        ? (body as { msg: string }).msg
        : null) || `Binance Futures error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return body;
}

/** Public futures endpoint: latest mark/last price. */
export async function getFuturesPrice(
  symbol: string,
  env: BinanceEnv = "prod",
): Promise<number> {
  const base = FUTURES_BASE_URLS[env];
  const res = await fetch(
    `${base}/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to fetch futures price for ${symbol}`);
  const body = (await res.json()) as { price: string };
  return Number(body.price);
}

export interface FuturesSymbolFilters {
  stepSize: number;
  minQty: number;
  minNotional: number;
  tickSize: number;
  maxLeverage: number;
}

/** LOT_SIZE / MIN_NOTIONAL / PRICE_FILTER for a futures symbol. */
export async function getFuturesSymbolFilters(
  symbol: string,
  env: BinanceEnv = "prod",
): Promise<FuturesSymbolFilters> {
  const base = FUTURES_BASE_URLS[env];
  const res = await fetch(`${base}/fapi/v1/exchangeInfo`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch futures exchange info`);
  const data = (await res.json()) as {
    symbols: { symbol: string; filters: Record<string, string>[] }[];
  };
  const sym = data.symbols.find((s) => s.symbol === symbol.toUpperCase());
  if (!sym) throw new Error(`الرمز ${symbol} غير متاح في سوق العقود الآجلة.`);
  const filters = sym.filters ?? [];
  const lot = filters.find((f) => f.filterType === "LOT_SIZE");
  const notional = filters.find((f) => f.filterType === "MIN_NOTIONAL");
  const price = filters.find((f) => f.filterType === "PRICE_FILTER");
  return {
    stepSize: lot ? Number(lot.stepSize) : 0.001,
    minQty: lot ? Number(lot.minQty) : 0,
    minNotional: notional ? Number(notional.notional) : 0,
    tickSize: price ? Number(price.tickSize) : 0.01,
    maxLeverage: 125,
  };
}

/** Sets ISOLATED margin (safer: liquidation risk limited to the position). */
export async function setIsolatedMargin(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol: string,
): Promise<void> {
  try {
    await futuresRequest(
      "POST",
      "/fapi/v1/marginType",
      { symbol, marginType: "ISOLATED" },
      apiKey,
      apiSecret,
      env,
    );
  } catch (e) {
    // -4046 "No need to change margin type" — already isolated.
    const msg = e instanceof Error ? e.message : "";
    if (!/no need to change/i.test(msg)) throw e;
  }
}

/** Sets the leverage for a symbol. Returns the leverage actually applied. */
export async function setLeverage(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol: string,
  leverage: number,
): Promise<number> {
  const res = (await futuresRequest(
    "POST",
    "/fapi/v1/leverage",
    { symbol, leverage: Math.max(1, Math.round(leverage)) },
    apiKey,
    apiSecret,
    env,
  )) as { leverage: number };
  return Number(res.leverage);
}

export interface FuturesPlacedOrder {
  orderId: number;
  symbol: string;
  side: string;
  status: string;
  type: string;
  executedQty: string;
  avgPrice: string;
  cumQuote: string;
  price: string;
}

/** MARKET order. side=SELL with no position opens a short. */
export async function placeFuturesMarketOrder(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number,
  reduceOnly = false,
): Promise<FuturesPlacedOrder> {
  return (await futuresRequest(
    "POST",
    "/fapi/v1/order",
    {
      symbol,
      side,
      type: "MARKET",
      quantity,
      ...(reduceOnly ? { reduceOnly: "true" } : {}),
    },
    apiKey,
    apiSecret,
    env,
  )) as FuturesPlacedOrder;
}

/** LIMIT order (pending entry — MT5-style). */
export async function placeFuturesLimitOrder(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number,
  price: number,
  reduceOnly = false,
): Promise<FuturesPlacedOrder> {
  return (await futuresRequest(
    "POST",
    "/fapi/v1/order",
    {
      symbol,
      side,
      type: "LIMIT",
      quantity,
      price,
      timeInForce: "GTC",
      ...(reduceOnly ? { reduceOnly: "true" } : {}),
    },
    apiKey,
    apiSecret,
    env,
  )) as FuturesPlacedOrder;
}

/**
 * STOP_MARKET / TAKE_PROFIT_MARKET exit covering the whole position
 * (closePosition=true). Used as SL/TP for both long and short positions.
 */
export async function placeFuturesExitOrder(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol: string,
  positionSide: "long" | "short",
  kind: "stop_loss" | "take_profit",
  triggerPrice: number,
): Promise<FuturesPlacedOrder> {
  // Long exits SELL, short exits BUY.
  const side = positionSide === "long" ? "SELL" : "BUY";
  const type = kind === "stop_loss" ? "STOP_MARKET" : "TAKE_PROFIT_MARKET";
  return (await futuresRequest(
    "POST",
    "/fapi/v1/order",
    {
      symbol,
      side,
      type,
      stopPrice: triggerPrice,
      closePosition: "true",
      workingType: "MARK_PRICE",
    },
    apiKey,
    apiSecret,
    env,
  )) as FuturesPlacedOrder;
}

export interface FuturesPosition {
  symbol: string;
  positionAmt: number; // negative = short
  entryPrice: number;
  markPrice: number;
  unRealizedProfit: number;
  leverage: number;
  isolatedMargin: number;
  liquidationPrice: number;
}

/** Open positions (non-zero amounts only). */
export async function getFuturesPositions(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol?: string,
): Promise<FuturesPosition[]> {
  const rows = (await futuresRequest(
    "GET",
    "/fapi/v2/positionRisk",
    symbol ? { symbol } : {},
    apiKey,
    apiSecret,
    env,
  )) as Record<string, string>[];
  return rows
    .map((r) => ({
      symbol: r.symbol,
      positionAmt: Number(r.positionAmt),
      entryPrice: Number(r.entryPrice),
      markPrice: Number(r.markPrice),
      unRealizedProfit: Number(r.unRealizedProfit),
      leverage: Number(r.leverage),
      isolatedMargin: Number(r.isolatedMargin),
      liquidationPrice: Number(r.liquidationPrice),
    }))
    .filter((p) => p.positionAmt !== 0);
}

export interface FuturesOpenOrder {
  orderId: number;
  symbol: string;
  side: string;
  type: string;
  price: number;
  stopPrice: number;
  origQty: number;
  reduceOnly: boolean;
}

/** Open (pending) orders, optionally for one symbol. */
export async function getFuturesOpenOrders(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol?: string,
): Promise<FuturesOpenOrder[]> {
  const rows = (await futuresRequest(
    "GET",
    "/fapi/v1/openOrders",
    symbol ? { symbol } : {},
    apiKey,
    apiSecret,
    env,
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    orderId: Number(r.orderId),
    symbol: String(r.symbol),
    side: String(r.side),
    type: String(r.type),
    price: Number(r.price),
    stopPrice: Number(r.stopPrice),
    origQty: Number(r.origQty),
    reduceOnly: Boolean(r.reduceOnly),
  }));
}

/** Query a single futures order by id. */
export async function getFuturesOrder(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol: string,
  orderId: number,
): Promise<FuturesPlacedOrder & { status: string }> {
  return (await futuresRequest(
    "GET",
    "/fapi/v1/order",
    { symbol, orderId },
    apiKey,
    apiSecret,
    env,
  )) as FuturesPlacedOrder & { status: string };
}

/** Cancels a single pending order. */
export async function cancelFuturesOrder(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol: string,
  orderId: number,
): Promise<void> {
  await futuresRequest(
    "DELETE",
    "/fapi/v1/order",
    { symbol, orderId },
    apiKey,
    apiSecret,
    env,
  );
}

/** Cancels all pending orders for a symbol (e.g. before re-placing SL/TP). */
export async function cancelAllFuturesOrders(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol: string,
): Promise<void> {
  await futuresRequest(
    "DELETE",
    "/fapi/v1/allOpenOrders",
    { symbol },
    apiKey,
    apiSecret,
    env,
  );
}

/** USDT-M futures account balance (USDT available + total). */
export async function getFuturesBalance(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
): Promise<{ available: number; total: number }> {
  const rows = (await futuresRequest(
    "GET",
    "/fapi/v2/balance",
    {},
    apiKey,
    apiSecret,
    env,
  )) as { asset: string; balance: string; availableBalance: string }[];
  const usdt = rows.find((r) => r.asset === "USDT");
  return {
    available: usdt ? Number(usdt.availableBalance) : 0,
    total: usdt ? Number(usdt.balance) : 0,
  };
}
