/**
 * MetaAPI provisioning REST — create a cloud account from the in-app
 * MetaTrader form, then read/delete it.
 *
 * Password is forwarded to MetaAPI in the create request only and is never
 * written to Lonora storage. Trade endpoints are out of scope (banned by
 * noExecutionGuard).
 */
import crypto from "crypto";
import { fetchWithTimeout } from "@/lib/externalFetch";
import { BROKER_PLATFORM } from "./brokers";

const PROVISIONING_ORIGIN =
  "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";

/** Magic used for every Lonora-created cloud account. Not an order. */
export const LONORA_MAGIC = 864018;

export type MetaapiAccountState =
  | "DRAFT"
  | "DEPLOYED"
  | "UNDEPLOYED"
  | "DEPLOYING"
  | "UNDEPLOYING"
  | string;

export class MetaapiClientError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "MetaapiClientError";
  }
}

export function newTransactionId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function headers(token: string, transactionId?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "auth-token": token,
  };
  if (transactionId) h["transaction-id"] = transactionId;
  return h;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryWaitMs(res: Response): number {
  const raw = res.headers.get("retry-after");
  if (!raw) return 8_000;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 15_000);
  }
  const when = Date.parse(raw);
  if (Number.isFinite(when)) {
    return Math.min(Math.max(when - Date.now(), 2_000), 15_000);
  }
  return 8_000;
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

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  const message = body.message;
  if (typeof message === "string" && message.trim()) {
    return message.replace(/\s+/g, " ").trim().slice(0, 400);
  }
  return fallback;
}

export async function createTradingAccount(input: {
  token: string;
  userId: number;
  server: string;
  login: string;
  password: string;
  region?: string;
  transactionId?: string;
}): Promise<{ id: string; state: MetaapiAccountState }> {
  const transactionId = input.transactionId ?? newTransactionId();
  const payload: Record<string, unknown> = {
    name: `Lonora ${input.userId}`,
    login: input.login,
    password: input.password,
    server: input.server,
    platform: BROKER_PLATFORM,
    magic: LONORA_MAGIC,
    type: "cloud-g2",
    reliability: "regular",
    metadata: { lonoraUserId: String(input.userId) },
  };
  const region = input.region?.trim();
  if (region) payload.region = region;

  // Bounded: 4 tries with the Retry-After wait capped at 15s keeps the
  // worst case near the route's own patience instead of many minutes.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchWithTimeout(
      `${PROVISIONING_ORIGIN}/users/current/accounts`,
      {
        method: "POST",
        headers: headers(input.token, transactionId),
        body: JSON.stringify(payload),
      },
      { timeoutMs: 45_000, label: "MetaAPI" },
    );
    const body = await readJson(res);
    if (res.status === 201 || res.status === 200) {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) {
        throw new MetaapiClientError(502, "MetaAPI did not return an account id.");
      }
      const state =
        typeof body.state === "string" ? body.state : "DEPLOYED";
      return { id, state };
    }
    if (res.status === 202) {
      await sleep(retryWaitMs(res));
      continue;
    }
    throw new MetaapiClientError(
      res.status >= 400 && res.status < 600 ? res.status : 502,
      errorMessage(body, "Could not link the trading account at MetaAPI."),
    );
  }
  throw new MetaapiClientError(504, "Timed out linking the trading account at MetaAPI.");
}

export async function readAccount(input: {
  token: string;
  accountId: string;
}): Promise<{
  id: string;
  state: MetaapiAccountState;
  login: string | null;
  connectionStatus: string | null;
}> {
  const res = await fetchWithTimeout(
    `${PROVISIONING_ORIGIN}/users/current/accounts/${encodeURIComponent(input.accountId)}`,
    {
      method: "GET",
      headers: headers(input.token),
    },
    { timeoutMs: 20_000, label: "MetaAPI" },
  );
  const body = await readJson(res);
  if (!res.ok) {
    throw new MetaapiClientError(
      res.status >= 400 && res.status < 600 ? res.status : 502,
      errorMessage(body, "Could not read the broker-link account."),
    );
  }
  return {
    id: typeof body.id === "string" ? body.id : input.accountId,
    state: typeof body.state === "string" ? body.state : "unknown",
    login: typeof body.login === "string" ? body.login : null,
    connectionStatus:
      typeof body.connectionStatus === "string" ? body.connectionStatus : null,
  };
}

export async function deleteAccount(input: {
  token: string;
  accountId: string;
}): Promise<void> {
  const res = await fetchWithTimeout(
    `${PROVISIONING_ORIGIN}/users/current/accounts/${encodeURIComponent(input.accountId)}`,
    {
      method: "DELETE",
      headers: headers(input.token),
    },
    { timeoutMs: 20_000, label: "MetaAPI" },
  );
  if (res.status === 404 || res.status === 204 || res.ok) return;
  const body = await readJson(res);
  throw new MetaapiClientError(
    res.status >= 400 && res.status < 600 ? res.status : 502,
    errorMessage(body, "Could not remove the broker-link account at MetaAPI."),
  );
}
