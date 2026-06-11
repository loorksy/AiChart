/**
 * Client for the self-hosted MT5 bridge container (infra/mt5) — MetaTrader 5
 * running under Wine on this server. No third-party services involved.
 */

import type { EaSymbolSpec } from "../types";

export function getMt5BridgeUrl(): string | null {
  const url = process.env.MT5_BRIDGE_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

export function isMt5LocalConfigured(): boolean {
  return getMt5BridgeUrl() !== null;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.MT5_BRIDGE_TOKEN?.trim();
  if (token) h["X-Bridge-Token"] = token;
  return h;
}

async function call<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
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
    });
  } catch {
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
}

export async function mt5Connect(creds: {
  login: string;
  password: string;
  server: string;
}): Promise<Mt5Account> {
  const res = await call<{ ok: boolean; account: Mt5Account }>("/connect", {
    method: "POST",
    body: creds,
  });
  return res.account;
}

export async function mt5Status(): Promise<{
  connected: boolean;
  account?: Mt5Account;
}> {
  return call("/status");
}

export async function mt5Price(
  symbol: string,
): Promise<{ symbol: string; bid: number; ask: number }> {
  return call(`/price?symbol=${encodeURIComponent(symbol)}`);
}

export async function mt5Spec(symbol: string): Promise<EaSymbolSpec> {
  return call(`/spec?symbol=${encodeURIComponent(symbol)}`);
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
): Promise<Mt5Bar[]> {
  const res = await call<{ bars: Mt5Bar[] }>(
    `/rates?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&count=${count}`,
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

export async function mt5Positions(): Promise<Mt5Position[]> {
  const res = await call<{ positions: Mt5Position[] }>("/positions");
  return res.positions;
}

export async function mt5Order(order: {
  symbol: string;
  side: "buy" | "sell";
  lots: number;
  sl?: number | null;
  tp?: number | null;
  comment?: string;
}): Promise<{
  ok: boolean;
  ticket?: number;
  price?: number;
  lots?: number;
  reason?: string;
}> {
  return call("/order", { method: "POST", body: order });
}

export async function mt5Close(target: {
  ticket?: number;
  all?: boolean;
}): Promise<{
  ok: boolean;
  closed: { ticket: number; symbol: string; lots: number; profit: number }[];
  errors: string[];
}> {
  return call("/close", { method: "POST", body: target });
}
