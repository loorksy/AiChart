/**
 * Client for the self-hosted MT5 bridge container (infra/mt5) — MetaTrader 5
 * running under Wine on this server. No third-party services involved.
 */

import type { EaSymbolSpec } from "../types";

/**
 * Identifies WHICH broker account an MT5-bridge call targets. Multi-tenant
 * safety invariant: every trade-execution call must name its account so the
 * bridge can ensure that exact account is active before sending the order —
 * a single shared terminal must never execute User A's order on User B.
 */
export interface Mt5AccountRef {
  login: string | number;
  server?: string;
}

function accountParams(account?: Mt5AccountRef): string {
  if (!account) return "";
  const p = new URLSearchParams();
  p.set("login", String(account.login));
  if (account.server) p.set("server", account.server);
  return p.toString();
}

function withAccount<T extends object>(
  body: T,
  account: Mt5AccountRef,
): T & { login: string; server?: string } {
  return {
    ...body,
    login: String(account.login),
    ...(account.server ? { server: account.server } : {}),
  };
}

export function getMt5BridgeUrl(): string | null {
  const url = process.env.MT5_BRIDGE_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

export function isMt5LocalConfigured(): boolean {
  return getMt5BridgeUrl() !== null;
}

/** Must stay below nginx proxy_read_timeout for /api/ (180s). */
const BRIDGE_FETCH_TIMEOUT_MS = 120_000;
const CONNECT_FETCH_TIMEOUT_MS = 45_000;

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.MT5_BRIDGE_TOKEN?.trim();
  if (token) h["X-Bridge-Token"] = token;
  return h;
}

async function call<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number },
): Promise<T> {
  const base = getMt5BridgeUrl();
  if (!base) {
    throw new Error("جسر MT5 غير مفعّل — عيّن MT5_BRIDGE_URL على الخادم.");
  }
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init?.method ?? "GET",
      headers: headers(),
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(init?.timeoutMs ?? BRIDGE_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(
        "انتهت مهلة الاتصال بجسر MT5 — قد يكون تسجيل الدخول بطيئاً أو الجسر متوقف.",
      );
    }
    throw new Error(
      "تعذّر الوصول لحاوية MT5 — تأكد أن خدمة mt5 تعمل (docker compose ps).",
    );
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `خطأ من جسر MT5 (HTTP ${res.status}).`);
  }
  return data;
}

export interface Mt5Account {
  login: number;
  server: string;
  balance: number;
  equity: number;
  margin: number;
  margin_free: number;
  currency: string;
  leverage: number;
  name: string;
  /**
   * ACCOUNT_TRADE_MODE from the terminal, when the bridge reports it. Optional
   * because older bridges do not send it — an unknown type is left unknown
   * rather than guessed.
   */
  trade_mode?: string;
}

export interface Mt5BridgeHealth {
  ok: boolean;
  initialized: boolean;
  connect_capable?: boolean;
}

export async function mt5BridgeHealth(): Promise<Mt5BridgeHealth> {
  return call<Mt5BridgeHealth>("/health", { timeoutMs: 8_000 });
}

/** True when the bridge env is set AND /health reports login is supported. */
export async function isMt5BridgeConnectCapable(): Promise<boolean> {
  if (!isMt5LocalConfigured()) return false;
  try {
    const health = await mt5BridgeHealth();
    return health.ok !== false && health.connect_capable !== false;
  } catch {
    return false;
  }
}

export async function mt5Connect(creds: {
  login: string;
  password: string;
  server: string;
}): Promise<Mt5Account> {
  const health = await mt5BridgeHealth().catch(() => null);
  if (health?.connect_capable === false) {
    throw new Error(
      "جسر MT5 على هذا الخادم لا يدعم تسجيل الدخول (Wine/Linux). فعّل الربط السحابي عبر MetaApi من الإعدادات.",
    );
  }
  const res = await call<{ ok: boolean; account: Mt5Account }>("/connect", {
    method: "POST",
    body: creds,
    timeoutMs: CONNECT_FETCH_TIMEOUT_MS,
  });
  return res.account;
}

export async function mt5Status(account: Mt5AccountRef): Promise<{
  connected: boolean;
  account?: Mt5Account;
}> {
  const qs = accountParams(account);
  return call(`/status${qs ? `?${qs}` : ""}`);
}

export async function mt5Price(
  symbol: string,
  account?: Mt5AccountRef,
): Promise<{ symbol: string; bid: number; ask: number }> {
  const qs = accountParams(account);
  return call(
    `/price?symbol=${encodeURIComponent(symbol)}${qs ? `&${qs}` : ""}`,
  );
}

export async function mt5Spec(
  symbol: string,
  account?: Mt5AccountRef,
): Promise<EaSymbolSpec> {
  const qs = accountParams(account);
  return call(`/spec?symbol=${encodeURIComponent(symbol)}${qs ? `&${qs}` : ""}`);
}

export interface Mt5Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export async function mt5Rates(
  symbol: string,
  timeframe: string,
  count = 120,
  account?: Mt5AccountRef,
): Promise<Mt5Bar[]> {
  const qs = accountParams(account);
  const res = await call<{ bars: Mt5Bar[] }>(
    `/rates?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&count=${count}${qs ? `&${qs}` : ""}`,
  );
  return res.bars;
}

export interface Mt5Position {
  ticket: number;
  symbol: string;
  side: "buy" | "sell";
  lots: number;
  open_price: number;
  current_price: number;
  sl: number;
  tp: number;
  profit: number;
}

export async function mt5Positions(
  account: Mt5AccountRef,
): Promise<Mt5Position[]> {
  const qs = accountParams(account);
  const res = await call<{ positions: Mt5Position[] }>(
    `/positions${qs ? `?${qs}` : ""}`,
  );
  return res.positions;
}

export async function mt5Order(
  account: Mt5AccountRef,
  order: {
    symbol: string;
    side: "buy" | "sell";
    lots: number;
    sl?: number | null;
    tp?: number | null;
    comment?: string;
  },
): Promise<{
  ok: boolean;
  ticket?: number;
  price?: number;
  lots?: number;
  reason?: string;
}> {
  return call("/order", { method: "POST", body: withAccount(order, account) });
}

export async function mt5Close(
  account: Mt5AccountRef,
  target: {
    ticket?: number;
    all?: boolean;
  },
): Promise<{
  ok: boolean;
  closed: { ticket: number; symbol: string; lots: number; profit: number }[];
  errors: string[];
}> {
  return call("/close", { method: "POST", body: withAccount(target, account) });
}
