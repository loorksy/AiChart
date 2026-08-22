/**
 * MetaAPI client-API REST for the manual execution layer (owner decision).
 *
 * The revived scope, read literally: the OPERATOR presses execute, and only
 * then does one market order — with its stop loss IN THE SAME REQUEST —
 * reach the broker through the account they linked themselves. Nothing in
 * the agent, the resident loop, the worker, or any schedule can reach this
 * module; the manualExecutionGuard pins that structurally.
 *
 * Everything here is a thin typed wrapper over MetaAPI's region-scoped
 * client API. No SDK dependency: plain REST through the platform's existing
 * fetch helper, so behavior stays inspectable and testable.
 */
import { fetchWithTimeout } from "@/lib/externalFetch";

/** The client API host is region-scoped (the account's deployment region). */
export function clientApiOrigin(region: string): string {
  const safe = /^[a-z0-9-]{2,32}$/i.test(region) ? region : "london";
  return `https://mt-client-api-v1.${safe}.agiliumtrade.ai`;
}

export class MetaapiTradeError extends Error {
  status: number;
  /** Short machine code the surfaces translate — never a lecture. */
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "MetaapiTradeError";
  }
}

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "auth-token": token,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 280) };
  }
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export interface TradeApiAuth {
  token: string;
  region: string;
  accountId: string;
}

async function getJson(
  auth: TradeApiAuth,
  path: string,
  timeoutMs = 15_000,
): Promise<unknown> {
  const res = await fetchWithTimeout(
    `${clientApiOrigin(auth.region)}/users/current/accounts/${encodeURIComponent(auth.accountId)}${path}`,
    { method: "GET", headers: headers(auth.token) },
    { timeoutMs, label: "MetaAPI" },
  );
  const body = await readJson(res);
  if (!res.ok) {
    throw new MetaapiTradeError(
      res.status,
      res.status === 401 || res.status === 403 ? "metaapi_auth" : "metaapi_error",
      str(body.message) ?? `MetaAPI request failed (${res.status})`,
    );
  }
  return body;
}

export interface AccountInformation {
  balance: number;
  equity: number | null;
  freeMargin: number | null;
  leverage: number | null;
  currency: string;
}

export async function getAccountInformation(
  auth: TradeApiAuth,
): Promise<AccountInformation> {
  const body = (await getJson(auth, "/account-information")) as Record<string, unknown>;
  const balance = num(body.balance);
  if (balance == null) {
    throw new MetaapiTradeError(502, "metaapi_error", "Account information carried no balance.");
  }
  return {
    balance,
    equity: num(body.equity),
    freeMargin: num(body.freeMargin),
    leverage: num(body.leverage),
    currency: str(body.currency) ?? "USD",
  };
}

export interface SymbolSpecification {
  symbol: string;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  contractSize: number;
}

export async function getSymbolSpecification(
  auth: TradeApiAuth,
  symbol: string,
): Promise<SymbolSpecification> {
  const body = (await getJson(
    auth,
    `/symbols/${encodeURIComponent(symbol)}/specification`,
  )) as Record<string, unknown>;
  return {
    symbol: str(body.symbol) ?? symbol,
    minVolume: num(body.minVolume) ?? 0.01,
    maxVolume: num(body.maxVolume) ?? 100,
    volumeStep: num(body.volumeStep) ?? 0.01,
    // XAUUSD is 100 oz/lot at almost every MT5 broker; the spec value wins
    // whenever the broker states one.
    contractSize: num(body.contractSize) ?? 100,
  };
}

// ---------------------------------------------------------------------------
// The order itself
// ---------------------------------------------------------------------------

export interface MarketOrderInput {
  direction: "buy" | "sell";
  symbol: string;
  volume: number;
  /** MANDATORY. An order without its stop is refused HERE, before any HTTP. */
  stopLoss: number;
  takeProfit?: number | null;
  /** Our execution identity at the broker — what reconciliation looks up. */
  clientId: string;
  comment?: string;
}

/**
 * The one payload builder. The stop-loss rides in the SAME request as the
 * order — a position without a stop, even for a second, is a policy
 * violation, so a missing stop throws before anything leaves the process.
 */
export function buildMarketOrderPayload(input: MarketOrderInput): Record<string, unknown> {
  if (!Number.isFinite(input.stopLoss) || input.stopLoss <= 0) {
    throw new MetaapiTradeError(400, "missing_stop", "An order must carry its stop loss.");
  }
  if (!Number.isFinite(input.volume) || input.volume <= 0) {
    throw new MetaapiTradeError(400, "invalid_volume", "Volume must be a positive number.");
  }
  const payload: Record<string, unknown> = {
    actionType: input.direction === "buy" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
    symbol: input.symbol,
    volume: input.volume,
    stopLoss: input.stopLoss,
    clientId: input.clientId,
  };
  if (input.takeProfit != null && Number.isFinite(input.takeProfit) && input.takeProfit > 0) {
    payload.takeProfit = input.takeProfit;
  }
  if (input.comment) payload.comment = String(input.comment).slice(0, 26);
  return payload;
}

export interface TradeResponse {
  ok: boolean;
  numericCode: number | null;
  stringCode: string | null;
  orderId: string | null;
  positionId: string | null;
  message: string | null;
}

/** MT5 retcodes → the short codes surfaces translate. */
export function tradeErrorCode(response: TradeResponse): string {
  const code = response.stringCode ?? "";
  if (/NO_MONEY/i.test(code) || response.numericCode === 10019) return "insufficient_margin";
  if (/INVALID_VOLUME|INVALID_LOTS/i.test(code) || response.numericCode === 10014) {
    return "invalid_volume";
  }
  if (/MARKET_CLOSED/i.test(code) || response.numericCode === 10018) return "market_closed";
  if (/TRADE_DISABLED/i.test(code) || response.numericCode === 10017) return "trade_disabled";
  if (/INVALID_STOPS/i.test(code) || response.numericCode === 10016) return "invalid_stops";
  return "broker_rejected";
}

/**
 * Send one market order. Success is the broker saying DONE — anything else
 * is a typed refusal, and a transport failure AFTER the request may have
 * gone out throws `send_unconfirmed`: the caller must reconcile by clientId
 * before any retry, never assume.
 */
export async function placeMarketOrder(
  auth: TradeApiAuth,
  input: MarketOrderInput,
): Promise<TradeResponse> {
  const payload = buildMarketOrderPayload(input);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${clientApiOrigin(auth.region)}/users/current/accounts/${encodeURIComponent(auth.accountId)}/trade`,
      { method: "POST", headers: headers(auth.token), body: JSON.stringify(payload) },
      { timeoutMs: 25_000, label: "MetaAPI" },
    );
  } catch (error) {
    // The request may or may not have reached the broker. Saying either
    // would be a guess — the caller reconciles by clientId instead.
    throw new MetaapiTradeError(
      504,
      "send_unconfirmed",
      error instanceof Error ? error.message : "trade send failed",
    );
  }
  const body = await readJson(res);
  const response: TradeResponse = {
    ok: false,
    numericCode: num(body.numericCode),
    stringCode: str(body.stringCode),
    orderId: str(body.orderId),
    positionId: str(body.positionId),
    message: str(body.message),
  };
  response.ok =
    res.ok &&
    (response.numericCode === 10009 ||
      response.stringCode === "TRADE_RETCODE_DONE" ||
      (response.numericCode == null && response.orderId != null));
  return response;
}

// ---------------------------------------------------------------------------
// Reconciliation + monitoring reads
// ---------------------------------------------------------------------------

export interface BrokerPosition {
  id: string;
  clientId: string | null;
  symbol: string;
  type: string;
  volume: number | null;
  openPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number | null;
  swap: number | null;
  commission: number | null;
  time: string | null;
}

function toPosition(raw: Record<string, unknown>): BrokerPosition {
  return {
    id: str(raw.id) ?? "",
    clientId: str(raw.clientId),
    symbol: str(raw.symbol) ?? "",
    type: str(raw.type) ?? "",
    volume: num(raw.volume),
    openPrice: num(raw.openPrice),
    stopLoss: num(raw.stopLoss),
    takeProfit: num(raw.takeProfit),
    profit: num(raw.profit),
    swap: num(raw.swap),
    commission: num(raw.commission),
    time: str(raw.time),
  };
}

export async function listPositions(auth: TradeApiAuth): Promise<BrokerPosition[]> {
  const body = await getJson(auth, "/positions");
  if (!Array.isArray(body)) return [];
  return body
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map(toPosition);
}

export interface BrokerDeal {
  id: string;
  clientId: string | null;
  positionId: string | null;
  orderId: string | null;
  symbol: string;
  type: string;
  entryType: string | null;
  volume: number | null;
  price: number | null;
  profit: number | null;
  swap: number | null;
  commission: number | null;
  time: string | null;
}

function toDeal(raw: Record<string, unknown>): BrokerDeal {
  return {
    id: str(raw.id) ?? "",
    clientId: str(raw.clientId),
    positionId: str(raw.positionId),
    orderId: str(raw.orderId),
    symbol: str(raw.symbol) ?? "",
    type: str(raw.type) ?? "",
    entryType: str(raw.entryType),
    volume: num(raw.volume),
    price: num(raw.price),
    profit: num(raw.profit),
    swap: num(raw.swap),
    commission: num(raw.commission),
    time: str(raw.time),
  };
}

/** Deals in [start, end] — the money answer for "closed trades". */
export async function listDealsByTimeRange(
  auth: TradeApiAuth,
  startMs: number,
  endMs: number,
): Promise<BrokerDeal[]> {
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  const body = await getJson(
    auth,
    `/history-deals/time/${encodeURIComponent(start)}/${encodeURIComponent(end)}`,
    20_000,
  );
  if (!Array.isArray(body)) return [];
  return body
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map(toDeal);
}

export interface ClientIdLookup {
  position: BrokerPosition | null;
  deal: BrokerDeal | null;
}

/**
 * Did an order carrying this clientId reach the broker? Checked against the
 * open positions first, then the last 48h of deals — the two places a filled
 * or already-closed order can appear. `null`/`null` after a lost response
 * means the order never made it, and only then may a fresh send happen.
 */
export async function findByClientId(
  auth: TradeApiAuth,
  clientId: string,
  now = Date.now(),
): Promise<ClientIdLookup> {
  const positions = await listPositions(auth);
  const position = positions.find((item) => item.clientId === clientId) ?? null;
  if (position) return { position, deal: null };
  const deals = await listDealsByTimeRange(auth, now - 48 * 3_600_000, now);
  const deal = deals.find((item) => item.clientId === clientId) ?? null;
  return { position: null, deal };
}
