import { z } from "zod";
import {
  isMetaApiConfigured,
  mapMetaApiError,
  provisionAccount,
  removeMetaApiAccount,
  clearRpcCache,
  getMetaApi,
  getRpcConnection,
} from "./metaapi/client";
import { isMt5LocalConfigured, isMt5BridgeConnectCapable, mt5Connect, mt5Status } from "./mt5local/client";
import {
  deleteMtAccount,
  getMtAccount,
  getMtAccountMeta,
  resolveForexBackendForUser,
  saveMtAccount,
  updateMtAccountStatus,
} from "./store";
import { mtModeToExecution, normalizeMtTradeMode } from "./executionEnv";
import type { MtPlatform } from "./markets/types";

export const mtConnectSchema = z.object({
  platform: z.enum(["mt4", "mt5"]),
  server: z.string().min(2, "اسم السيرفر مطلوب."),
  login: z.string().min(1, "رقم الحساب مطلوب."),
  password: z.string().min(1, "كلمة المرور مطلوبة."),
});

export type MtConnectInput = z.infer<typeof mtConnectSchema>;

const WINE_IPC_HINT =
  "تسجيل MT5 على Linux/Wine غير مدعوم (IPC -10005). أضِف METAAPI_TOKEN من لوحة المنصّة للربط السحابي.";

function isWineIpcError(message: string): boolean {
  return /-10005|IPC timeout|IPC unavailable/i.test(message);
}

async function connectViaMetaApi(userId: number, input: MtConnectInput, login: string) {
  if (!isMetaApiConfigured()) {
    throw new Error(
      "ربط الفوركس السحابي غير متاح — أضِف METAAPI_TOKEN من لوحة المنصّة.",
    );
  }

  const existing = await getMtAccount(userId);
  if (
    existing?.metaapi_account_id &&
    existing.metaapi_account_id !== "mt5local"
  ) {
    clearRpcCache(userId);
    try {
      await removeMetaApiAccount(existing.metaapi_account_id);
    } catch {
      /* best effort */
    }
    await deleteMtAccount(userId);
  }

  const account = await provisionAccount({
    platform: input.platform,
    server: input.server.trim(),
    login,
    password: input.password,
    name: `Lonora u${userId}`,
  });

  await saveMtAccount(userId, {
    platform: input.platform,
    server: input.server.trim(),
    login,
    password: input.password,
    metaapiAccountId: account.id,
    region: account.region ?? null,
    state: account.state,
    connectionStatus: account.connectionStatus,
  });

  // V2-B (#96): metering starts the moment the account exists, and the
  // one-time year backfill runs in the background — a backfill failure
  // never fails the link (the warehouse gap-fix covers the rest later).
  void (async () => {
    try {
      const { openDeploySession, markPresence } = await import("./metaapi/lifecycle");
      await openDeploySession(userId, account.id, "first_link");
      await markPresence(userId);
      // Establish demo-vs-real as soon as the RPC is synchronized. The status
      // poll would get there eventually, but execution must never be evaluated
      // against an account whose type was simply never asked for.
      try {
        const conn = await getRpcConnection(userId, account.id);
        const info = await conn.getAccountInformation();
        if (info.type) {
          await updateMtAccountStatus(userId, { accountTradeMode: info.type });
        }
        // Seed the shared catalogue from what THIS account actually reports.
        // Later users linking a different broker still get a populated list;
        // origin stays 'broker' so nothing is labelled as the platform feed.
        try {
          const symbols = await conn.getSymbols();
          const { seedBrokerSymbols } = await import("./markets/symbolCatalogue");
          await seedBrokerSymbols({
            userId,
            metaapiAccountId: account.id,
            symbols: Array.isArray(symbols) ? symbols : [],
          });
        } catch (seedErr) {
          console.error(
            "[mtConnect] symbol catalogue seed failed:",
            seedErr instanceof Error ? seedErr.message : seedErr,
          );
        }
      } catch {
        /* the next status poll retries */
      }
      const { backfillYearForUser } = await import("./metaapi/backfill");
      await backfillYearForUser(userId, account.id);
    } catch (e) {
      console.error("[mtConnect] post-link setup failed:", e instanceof Error ? e.message : e);
    }
  })();

  return {
    ok: true as const,
    platform: input.platform,
    login,
    server: input.server.trim(),
    state: account.state,
    connectionStatus: account.connectionStatus,
    online:
      account.state === "DEPLOYED" &&
      account.connectionStatus === "CONNECTED",
  };
}

/** Connect MT4/MT5 via MetaApi or self-hosted mt5local bridge. */
export async function connectMtAccount(userId: number, input: MtConnectInput) {
  const backend = await resolveForexBackendForUser(userId);

  const login = input.login.replace(/\D/g, "");
  if (!login) {
    throw new Error("رقم الحساب يجب أن يحتوي على أرقام فقط.");
  }

  if (backend === "mt5local") {
    if (!isMt5LocalConfigured()) {
      throw new Error("حاوية MT5 غير مفعّلة (MT5_BRIDGE_URL مفقود).");
    }
    if (!(await isMt5BridgeConnectCapable())) {
      if (isMetaApiConfigured()) {
        return connectViaMetaApi(userId, input, login);
      }
      throw new Error(WINE_IPC_HINT);
    }
    try {
      const account = await mt5Connect({
        login,
        password: input.password,
        server: input.server.trim(),
      });
      await saveMtAccount(userId, {
        platform: "mt5",
        server: input.server.trim(),
        login,
        password: input.password,
        metaapiAccountId: "mt5local",
        state: "DEPLOYED",
        connectionStatus: "CONNECTED",
        balance: account.balance,
        equity: account.equity,
        currency: account.currency,
        accountTradeMode: account.trade_mode ?? null,
      });
      return {
        ok: true as const,
        platform: "mt5" as MtPlatform,
        login,
        server: input.server.trim(),
        state: "DEPLOYED",
        connectionStatus: "CONNECTED",
        online: true,
        balance: account.balance,
        equity: account.equity,
        currency: account.currency,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isWineIpcError(msg) && isMetaApiConfigured()) {
        return connectViaMetaApi(userId, input, login);
      }
      if (isWineIpcError(msg)) {
        throw new Error(WINE_IPC_HINT);
      }
      throw err;
    }
  }

  return connectViaMetaApi(userId, input, login);
}

/** Disconnect MetaTrader (MetaApi or mt5local). */
export async function disconnectMtAccount(userId: number) {
  const existing = await getMtAccount(userId);
  if (!existing) {
    return { ok: true as const };
  }

  clearRpcCache(userId);
  if (
    existing.metaapi_account_id &&
    existing.metaapi_account_id !== "mt5local"
  ) {
    try {
      await removeMetaApiAccount(existing.metaapi_account_id);
    } catch {
      /* account may already be gone on MetaApi side */
    }
  }
  await deleteMtAccount(userId);
  return { ok: true as const };
}

/** Live MetaTrader connection status for MetaApi or mt5local. */
export async function getMtConnectionStatus(userId: number) {
  const backend = await resolveForexBackendForUser(userId);

  if (backend === "mt5local") {
    const meta = await getMtAccountMeta(userId);
    if (!meta) {
      return {
        backend: "mt5local" as const,
        connected: false,
        online: false,
      };
    }
    try {
      const status = await mt5Status({ login: meta.login, server: meta.server });
      const online = Boolean(status.connected);
      await updateMtAccountStatus(userId, {
        state: online ? "DEPLOYED" : "UNDEPLOYED",
        connectionStatus: online ? "CONNECTED" : "DISCONNECTED",
        ...(status.account
          ? {
              balance: status.account.balance,
              equity: status.account.equity,
              currency: status.account.currency,
              accountTradeMode: status.account.trade_mode ?? null,
            }
          : {}),
      });
      return {
        backend: "mt5local" as const,
        connected: true,
        online,
        state: online ? "DEPLOYED" : "UNDEPLOYED",
        connectionStatus: online ? "CONNECTED" : "DISCONNECTED",
        balance: status.account?.balance ?? meta.balance,
        equity: status.account?.equity ?? meta.equity,
        currency: status.account?.currency ?? meta.currency,
        account_type: mtModeToExecution(
          normalizeMtTradeMode(status.account?.trade_mode ?? meta.account_trade_mode),
        ),
      };
    } catch (e) {
      return {
        backend: "mt5local" as const,
        connected: true,
        online: false,
        error: e instanceof Error ? e.message : "تعذّر الوصول لحاوية MT5.",
      };
    }
  }

  const meta = await getMtAccountMeta(userId);
  if (!meta) {
    return {
      backend: "metaapi" as const,
      connected: false,
      online: false,
    };
  }

  const row = await getMtAccount(userId);
  if (!row?.metaapi_account_id) {
    return {
      backend: "metaapi" as const,
      connected: false,
      online: false,
    };
  }

  try {
    const api = await getMetaApi();
    const account = await api.metatraderAccountApi.getAccount(
      row.metaapi_account_id,
    );
    await account.reload();

    let balance = meta.balance;
    let equity = meta.equity;
    let currency = meta.currency;
    // The broker's own demo/real verdict. Nothing else on a cloud connection
    // can tell the two apart, and the live-execution gate depends on it.
    let tradeMode: string | null = null;

    if (
      account.state === "DEPLOYED" &&
      account.connectionStatus === "CONNECTED"
    ) {
      try {
        const conn = await getRpcConnection(userId, row.metaapi_account_id);
        const info = await conn.getAccountInformation();
        balance = Number(info.balance) || balance;
        equity = Number(info.equity) || equity;
        currency = info.currency ?? currency;
        tradeMode = info.type ?? null;
      } catch {
        /* RPC may still be syncing */
      }
    }

    await updateMtAccountStatus(userId, {
      state: account.state,
      connectionStatus: account.connectionStatus,
      balance,
      equity,
      currency,
      accountTradeMode: tradeMode,
    });

    const online =
      account.state === "DEPLOYED" &&
      account.connectionStatus === "CONNECTED";

    return {
      backend: "metaapi" as const,
      connected: true,
      online,
      platform: meta.platform,
      server: meta.server,
      login: meta.login,
      balance,
      equity,
      currency,
      account_type: mtModeToExecution(
        normalizeMtTradeMode(tradeMode ?? meta.account_trade_mode),
      ),
      state: account.state,
      connectionStatus: account.connectionStatus,
      updated_at: new Date().toISOString(),
    };
  } catch {
    return {
      backend: "metaapi" as const,
      connected: true,
      online: false,
      platform: meta.platform,
      server: meta.server,
      login: meta.login,
      balance: meta.balance,
      equity: meta.equity,
      currency: meta.currency,
      account_type: mtModeToExecution(normalizeMtTradeMode(meta.account_trade_mode)),
      state: meta.state,
      connectionStatus: meta.connection_status,
      updated_at: meta.updated_at,
    };
  }
}

export function formatMtConnectError(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues[0]?.message ?? "بيانات غير صالحة.";
  }
  if (err instanceof Error) {
    return mapMetaApiError(err);
  }
  return mapMetaApiError(err);
}
