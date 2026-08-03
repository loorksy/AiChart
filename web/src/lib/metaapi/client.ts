import type { MtPlatform } from "../markets/types";
import { getPlatformValue, getPlatformValueAsync } from "../platformConfig";
import type { EaSymbolSpec } from "../types";

/**
 * Lazy-loaded MetaApi SDK (server-only, heavy native deps).
 *
 * The "/esm-node" subpath is load-bearing. The package's root export maps the
 * `import` condition to dists/esm-web — a browser bundle that touches `window`
 * at module scope — and reserves the Node build for `require`. A dynamic
 * import() from a server component therefore picks the web build and dies with
 * "ReferenceError: window is not defined" before a single account is reached.
 * metaapi.cloud-sdk is in serverExternalPackages, so this is resolved by Node
 * at runtime rather than rewritten by the bundler, and the condition applies.
 *
 * "/esm-node" (not "/node") because its default export IS the MetaApi class,
 * matching the callers below; the CJS subpath nests it one level deeper.
 */
async function loadMetaApiClass() {
  const mod = await import("metaapi.cloud-sdk/esm-node");
  return mod.default;
}

type MetaApiClass = Awaited<ReturnType<typeof loadMetaApiClass>>;
type MetaApiClient = InstanceType<MetaApiClass>;

/** Minimal RPC surface used by AiChart (avoids brittle SDK instance typing). */
export type MetaApiRpcConnection = {
  connect(): Promise<void>;
  waitSynchronized(timeoutInSeconds?: number): Promise<unknown>;
  getSymbolSpecification(symbol: string): Promise<Record<string, unknown>>;
  getSymbolPrice(
    symbol: string,
    keepSubscription: boolean,
  ): Promise<{ bid: number; ask: number }>;
  getAccountInformation(): Promise<{
    balance: number;
    equity: number;
    currency?: string;
    /** MT5's ACCOUNT_TRADE_MODE — the only signal that says demo vs real. */
    type?: string;
  }>;
  getSymbols(): Promise<string[]>;
  createMarketBuyOrder(
    symbol: string,
    volume: number,
    stopLoss?: number,
    takeProfit?: number,
    options?: { comment?: string },
  ): Promise<{ orderId?: string | number; positionId?: string | number }>;
  createMarketSellOrder(
    symbol: string,
    volume: number,
    stopLoss?: number,
    takeProfit?: number,
    options?: { comment?: string },
  ): Promise<{ orderId?: string | number; positionId?: string | number }>;
  /**
   * Trade management on an open position. Present on MetaApi's RPC connection;
   * declared here so the agent can move a stop on a cloud account instead of
   * queueing a command at an EA the account never had.
   */
  modifyPosition(
    positionId: string,
    stopLoss?: number,
    takeProfit?: number,
  ): Promise<Record<string, unknown>>;
  closePositionPartially(
    positionId: string,
    volume: number,
    options?: { comment?: string },
  ): Promise<Record<string, unknown>>;
  cancelOrder(orderId: string): Promise<Record<string, unknown>>;
};

const rpcCache = new Map<number, Promise<MetaApiRpcConnection>>();

/** True when METAAPI_TOKEN is set in platform config or env. */
export function isMetaApiConfigured(): boolean {
  return Boolean(getPlatformValue("METAAPI_TOKEN")?.trim());
}

export async function isMetaApiConfiguredAsync(): Promise<boolean> {
  return Boolean((await getPlatformValueAsync("METAAPI_TOKEN"))?.trim());
}

async function metaApiRegion(): Promise<string | undefined> {
  const region = (await getPlatformValueAsync("METAAPI_REGION"))?.trim();
  return region || undefined;
}

let metaApiSingleton: MetaApiClient | null = null;

/** Builds (or returns cached) MetaApi client from platform token + region. */
export async function getMetaApi(): Promise<MetaApiClient> {
  const token = (await getPlatformValueAsync("METAAPI_TOKEN"))?.trim();
  if (!token) {
    throw new Error("MetaApi غير مهيّأ. أضف METAAPI_TOKEN في إعدادات المنصة.");
  }
  if (!metaApiSingleton) {
    const MetaApi = await loadMetaApiClass();
    const region = await metaApiRegion();
    metaApiSingleton = new MetaApi(token, {
      application: "AiChart",
      ...(region ? { region } : {}),
    });
  }
  return metaApiSingleton;
}

export interface ProvisionMtInput {
  platform: MtPlatform;
  server: string;
  login: string;
  password: string;
  name?: string;
}

/** Creates a cloud MetaTrader account on MetaApi and deploys it. */
export async function provisionAccount(input: ProvisionMtInput) {
  const api = await getMetaApi();
  const region = await metaApiRegion();

  const account = await api.metatraderAccountApi.createAccount({
    name: input.name ?? `AiChart ${input.login}`,
    login: input.login.replace(/\D/g, ""),
    password: input.password,
    server: input.server.trim(),
    platform: input.platform,
    magic: 202606,
    ...(region ? { region } : {}),
  });

  await account.deploy();
  try {
    await account.waitDeployed(120);
    await account.waitConnected(120);
  } catch {
    // Account may still be connecting; caller can poll status.
  }

  return account;
}

/** Removes account from MetaApi (undeploy + delete). */
export async function removeMetaApiAccount(metaapiAccountId: string): Promise<void> {
  const api = await getMetaApi();
  const account = await api.metatraderAccountApi.getAccount(metaapiAccountId);
  try {
    await account.undeploy();
    await account.waitUndeployed(60);
  } catch {
    /* may already be undeployed */
  }
  await account.remove();
}

/** RPC connection for a user's MetaApi account (cached per userId). */
export async function getRpcConnection(
  userId: number,
  metaapiAccountId: string,
): Promise<MetaApiRpcConnection> {
  const cached = rpcCache.get(userId);
  if (cached) return cached;

  const promise = (async () => {
    const api = await getMetaApi();
    const account = await api.metatraderAccountApi.getAccount(metaapiAccountId);
    if (account.state !== "DEPLOYED") {
      await account.deploy();
      await account.waitDeployed(120);
    }
    if (account.connectionStatus !== "CONNECTED") {
      await account.waitConnected(120);
    }
    const conn = account.getRPCConnection();
    await conn.connect();
    await conn.waitSynchronized(60);
    return conn as MetaApiRpcConnection;
  })();

  rpcCache.set(userId, promise);
  promise.catch(() => {
    rpcCache.delete(userId);
  });
  return promise;
}

export function clearRpcCache(userId?: number): void {
  if (userId != null) rpcCache.delete(userId);
  else rpcCache.clear();
}

/** Maps MetaApi symbol spec to our lot-sizing shape. */
export function metaApiSpecToEaSpec(
  symbol: string,
  spec: Record<string, unknown>,
  price?: { bid?: number; ask?: number },
): EaSymbolSpec {
  const minLot =
    Number(spec.minVolume ?? spec.volumeMin ?? spec.minLot) || 0.01;
  const maxLot =
    Number(spec.maxVolume ?? spec.volumeMax ?? spec.maxLot) || 100;
  const lotStep =
    Number(spec.volumeStep ?? spec.volume_step ?? spec.lotStep) || 0.01;

  return {
    symbol,
    bid: price?.bid ?? (Number(spec.bid) || undefined),
    ask: price?.ask ?? (Number(spec.ask) || undefined),
    digits: Number(spec.digits) || undefined,
    point: Number(spec.point) || undefined,
    contract_size: Number(spec.contractSize ?? spec.contract_size) || 100_000,
    tick_value: Number(spec.tickValue ?? spec.tick_value) || undefined,
    tick_size: Number(spec.tickSize ?? spec.tick_size) || undefined,
    min_lot: minLot,
    max_lot: maxLot,
    lot_step: lotStep,
  };
}

/** Human-readable Arabic error from MetaApi provisioning failures. */
export function mapMetaApiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const details =
    err && typeof err === "object" && "details" in err
      ? String((err as { details?: string }).details ?? "")
      : "";

  if (/E_AUTH|invalid credentials|authentication/i.test(`${msg} ${details}`)) {
    return "بيانات الدخول غير صحيحة. تحقق من رقم الحساب وكلمة المرور والسيرفر.";
  }
  if (/E_SRV_NOT_FOUND|server.*not found/i.test(`${msg} ${details}`)) {
    return "اسم السيرفر غير معروف. انسخه حرفياً من تطبيق MetaTrader (مثل ICMarketsSC-Demo).";
  }
  if (/DRAFT/i.test(`${msg} ${details}`)) {
    return "الحساب بحاجة إعداد إضافي. تواصل مع الدعم.";
  }
  if (/IPC timeout|-10005/i.test(`${msg} ${details}`)) {
    return "تعذّر الاتصال بمنصّة MetaTrader على الخادم (IPC). جرّب ربط EA من الإعدادات أو تواصل مع الدعم.";
  }
  if (/timeout|Timeout/i.test(msg)) {
    return "انتهت مهلة الاتصال بالوسيط. جرّب لاحقاً أو تحقق من السيرفر.";
  }
  return msg.length > 120 ? "تعذّر ربط الحساب. تحقق من البيانات وحاول مجدداً." : msg;
}
