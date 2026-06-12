import crypto from "crypto";

export type BinanceEnv = "testnet" | "prod";

// Signed/account endpoints (require API keys).
const BASE_URLS: Record<BinanceEnv, string> = {
  testnet: "https://testnet.binance.vision",
  prod: "https://api.binance.com",
};

// Public market-data endpoints. `data-api.binance.vision` is Binance's
// dedicated public market-data host and is not geo-restricted, which keeps
// the agent's monitoring layer working across regions.
export const PUBLIC_DATA_URLS: Record<BinanceEnv, string> = {
  testnet: "https://testnet.binance.vision",
  prod: "https://data-api.binance.vision",
};

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface AccountSummary {
  canTrade: boolean;
  canWithdraw: boolean;
  balances: BinanceBalance[];
}

function sign(query: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function signedGet(
  endpoint: string,
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
): Promise<unknown> {
  const base = BASE_URLS[env];
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}&recvWindow=10000`;
  const signature = sign(query, apiSecret);
  const url = `${base}${endpoint}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { "X-MBX-APIKEY": apiKey },
    cache: "no-store",
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "msg" in body
        ? (body as { msg: string }).msg
        : null) || `Binance error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return body;
}

/**
 * Verifies API credentials by fetching the spot account. Returns a trimmed
 * summary including whether withdrawals are (dangerously) enabled.
 */
export async function getAccountSummary(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
): Promise<AccountSummary> {
  const data = (await signedGet(
    "/api/v3/account",
    apiKey,
    apiSecret,
    env,
  )) as {
    canTrade: boolean;
    canWithdraw: boolean;
    balances: BinanceBalance[];
  };

  const balances = (data.balances || []).filter(
    (b) => Number(b.free) > 0 || Number(b.locked) > 0,
  );

  return {
    canTrade: Boolean(data.canTrade),
    canWithdraw: Boolean(data.canWithdraw),
    balances,
  };
}

export interface ApiRestrictions {
  enableSpotAndMarginTrading: boolean;
  enableFutures: boolean;
  enableWithdrawals: boolean;
  ipRestrict: boolean;
}

/**
 * API key permission report (prod only — testnet has no /sapi).
 * Used to warn loudly when withdrawals are enabled on the key.
 */
export async function getApiRestrictions(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
): Promise<ApiRestrictions | null> {
  if (env !== "prod") return null;
  try {
    const data = (await signedGet(
      "/sapi/v1/account/apiRestrictions",
      apiKey,
      apiSecret,
      env,
    )) as Record<string, boolean>;
    return {
      enableSpotAndMarginTrading: Boolean(data.enableSpotAndMarginTrading),
      enableFutures: Boolean(data.enableFutures),
      enableWithdrawals: Boolean(data.enableWithdrawals),
      ipRestrict: Boolean(data.ipRestrict),
    };
  } catch {
    return null; // non-fatal: some key types can't read restrictions
  }
}

/** Public endpoint: latest price for a symbol (no auth needed). */
export async function getPrice(
  symbol: string,
  env: BinanceEnv = "prod",
): Promise<number> {
  const base = PUBLIC_DATA_URLS[env];
  const res = await fetch(
    `${base}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to fetch price for ${symbol}`);
  const body = (await res.json()) as { price: string };
  return Number(body.price);
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Public endpoint: candlesticks for a symbol/interval. */
export async function getKlines(
  symbol: string,
  interval: string,
  limit = 200,
  env: BinanceEnv = "prod",
): Promise<Candle[]> {
  const base = PUBLIC_DATA_URLS[env];
  const url = `${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      body && typeof body === "object" && "msg" in body
        ? (body as { msg: string }).msg
        : `Failed to fetch klines for ${symbol}`;
    throw new Error(msg);
  }
  const rows = (await res.json()) as unknown[][];
  return rows.map((r) => ({
    openTime: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}

async function signedRequest(
  method: "GET" | "POST" | "DELETE",
  endpoint: string,
  params: Record<string, string | number>,
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
): Promise<unknown> {
  const base = BASE_URLS[env];
  const query =
    Object.entries({ ...params, timestamp: Date.now(), recvWindow: 10000 })
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
      body && typeof body === "object" && "msg" in body
        ? (body as { msg: string }).msg
        : `Binance error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return body;
}

export interface SymbolFilters {
  stepSize: number;
  minQty: number;
  minNotional: number;
  tickSize: number;
}

/** Fetches LOT_SIZE / NOTIONAL filters needed to build valid orders. */
export async function getSymbolFilters(
  symbol: string,
  env: BinanceEnv = "prod",
): Promise<SymbolFilters> {
  const base = PUBLIC_DATA_URLS[env];
  const res = await fetch(
    `${base}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to fetch exchange info for ${symbol}`);
  const data = (await res.json()) as {
    symbols: { filters: Record<string, string>[] }[];
  };
  const filters = data.symbols?.[0]?.filters ?? [];
  const lot = filters.find((f) => f.filterType === "LOT_SIZE");
  const notional = filters.find(
    (f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL",
  );
  const price = filters.find((f) => f.filterType === "PRICE_FILTER");
  return {
    stepSize: lot ? Number(lot.stepSize) : 0.00000001,
    minQty: lot ? Number(lot.minQty) : 0,
    minNotional: notional ? Number(notional.minNotional ?? notional.notional) : 0,
    tickSize: price ? Number(price.tickSize) : 0.01,
  };
}

/** Rounds a quantity down to the symbol's step size. */
export function roundToStep(qty: number, stepSize: number): number {
  if (stepSize <= 0) return qty;
  const decimals = Math.max(0, Math.round(-Math.log10(stepSize)));
  const rounded = Math.floor(qty / stepSize) * stepSize;
  return Number(rounded.toFixed(decimals));
}

/** Rounds a price down to the symbol's tick size. */
export function roundToTick(price: number, tickSize: number): number {
  if (tickSize <= 0) return price;
  const decimals = Math.max(0, Math.round(-Math.log10(tickSize)));
  const rounded = Math.floor(price / tickSize) * tickSize;
  return Number(rounded.toFixed(decimals));
}

export interface PlacedOrder {
  orderId: number;
  symbol: string;
  side: string;
  status: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  fills?: { price: string; qty: string }[];
}

export interface PlacedOcoOrder {
  orderListId: number;
  listStatusType: string;
}

export interface OcoOrderListStatus {
  orderListId: number;
  listStatusType: string;
  orders: {
    status: string;
    executedQty: string;
    cummulativeQuoteQty: string;
    price: string;
  }[];
}

/** Fetches OCO order list status (for sync when TP/SL fills on Binance). */
export async function getOcoOrderList(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  orderListId: string | number,
): Promise<OcoOrderListStatus> {
  return (await signedRequest(
    "GET",
    "/api/v3/orderList",
    { orderListId },
    apiKey,
    apiSecret,
    env,
  )) as OcoOrderListStatus;
}

/** Places an OCO exit (TP limit + stop) for a long spot position. */
export async function placeOcoOrder(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol: string,
  quantity: number,
  takeProfitPrice: number,
  stopPrice: number,
  tickSize: number,
): Promise<PlacedOcoOrder> {
  const price = roundToTick(takeProfitPrice, tickSize);
  const stop = roundToTick(stopPrice, tickSize);
  const stopLimit = roundToTick(stopPrice * 0.999, tickSize);

  return (await signedRequest(
    "POST",
    "/api/v3/order/oco",
    {
      symbol,
      side: "SELL",
      quantity,
      price,
      stopPrice: stop,
      stopLimitPrice: stopLimit,
      stopLimitTimeInForce: "GTC",
    },
    apiKey,
    apiSecret,
    env,
  )) as PlacedOcoOrder;
}

/** Places a MARKET order on the spot account. */
export async function placeMarketOrder(
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number,
): Promise<PlacedOrder> {
  return (await signedRequest(
    "POST",
    "/api/v3/order",
    { symbol, side, type: "MARKET", quantity },
    apiKey,
    apiSecret,
    env,
  )) as PlacedOrder;
}

/** 24h ticker stats (price change %, high, low, volume). */
export async function get24hStats(
  symbol: string,
  env: BinanceEnv = "prod",
): Promise<{ priceChangePercent: number; high: number; low: number; volume: number }> {
  const base = PUBLIC_DATA_URLS[env];
  const res = await fetch(
    `${base}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to fetch 24h stats for ${symbol}`);
  const b = (await res.json()) as {
    priceChangePercent: string;
    highPrice: string;
    lowPrice: string;
    volume: string;
  };
  return {
    priceChangePercent: Number(b.priceChangePercent),
    high: Number(b.highPrice),
    low: Number(b.lowPrice),
    volume: Number(b.volume),
  };
}
