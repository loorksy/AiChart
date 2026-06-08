import crypto from "crypto";

export type BinanceEnv = "testnet" | "prod";

const BASE_URLS: Record<BinanceEnv, string> = {
  testnet: "https://testnet.binance.vision",
  prod: "https://api.binance.com",
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

/** Public endpoint: latest price for a symbol (no auth needed). */
export async function getPrice(
  symbol: string,
  env: BinanceEnv = "prod",
): Promise<number> {
  const base = BASE_URLS[env];
  const res = await fetch(
    `${base}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to fetch price for ${symbol}`);
  const body = (await res.json()) as { price: string };
  return Number(body.price);
}
