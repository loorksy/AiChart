/**
 * MetaAPI provisioning REST — DRAFT create + hosted configuration link only.
 *
 * No SDK. No login/password in any request we send. Trade endpoints are out
 * of scope (and banned by noExecutionGuard).
 */
import crypto from "crypto";
import { fetchWithTimeout } from "@/lib/externalFetch";
import { BROKER_PLATFORM, type BrokerOption } from "./brokers";
import { isHostedConfigUrl } from "./hostedUrl";

export { CONFIG_LINK_ORIGIN, isHostedConfigUrl } from "./hostedUrl";

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
    return Math.min(seconds * 1000, 60_000);
  }
  const when = Date.parse(raw);
  if (Number.isFinite(when)) {
    return Math.min(Math.max(when - Date.now(), 2_000), 60_000);
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

export async function createDraftAccount(input: {
  token: string;
  userId: number;
  broker: BrokerOption;
  region?: string;
  transactionId?: string;
}): Promise<{ id: string; state: MetaapiAccountState }> {
  const transactionId = input.transactionId ?? newTransactionId();
  const payload: Record<string, unknown> = {
    name: `Lonora ${input.userId}`,
    server: input.broker.server,
    platform: BROKER_PLATFORM,
    magic: LONORA_MAGIC,
    type: "cloud-g2",
    reliability: "high",
    metadata: { lonoraUserId: String(input.userId), brokerId: input.broker.id },
  };
  if (input.broker.keywords?.length) payload.keywords = input.broker.keywords;
  const region = input.region?.trim();
  if (region) payload.region = region;

  for (let attempt = 0; attempt < 8; attempt++) {
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
        typeof body.state === "string" ? body.state : "DRAFT";
      return { id, state };
    }
    if (res.status === 202) {
      await sleep(retryWaitMs(res));
      continue;
    }
    throw new MetaapiClientError(
      res.status >= 400 && res.status < 600 ? res.status : 502,
      errorMessage(body, "Could not create the broker-link account at MetaAPI."),
    );
  }
  throw new MetaapiClientError(504, "Timed out creating the broker-link account at MetaAPI.");
}

export async function createConfigurationLink(input: {
  token: string;
  accountId: string;
  ttlInDays?: number;
}): Promise<string> {
  const ttl = input.ttlInDays ?? 1;
  const res = await fetchWithTimeout(
    `${PROVISIONING_ORIGIN}/users/current/accounts/${encodeURIComponent(input.accountId)}/configuration-link?ttlInDays=${ttl}`,
    {
      method: "PUT",
      headers: headers(input.token),
    },
    { timeoutMs: 20_000, label: "MetaAPI" },
  );
  const body = await readJson(res);
  if (!res.ok) {
    throw new MetaapiClientError(
      res.status >= 400 && res.status < 600 ? res.status : 502,
      errorMessage(body, "Could not mint the credentials link."),
    );
  }
  const link =
    typeof body.configurationLink === "string" ? body.configurationLink : "";
  if (!isHostedConfigUrl(link)) {
    throw new MetaapiClientError(502, "MetaAPI returned a credentials URL that is not hosted.");
  }
  return link;
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
