import { z } from "zod";
import { getForexBackend } from "./brokers/forexBackend";
import {
  isMetaApiConfigured,
  mapMetaApiError,
  provisionAccount,
  removeMetaApiAccount,
  clearRpcCache,
  getMetaApi,
  getRpcConnection,
} from "./metaapi/client";
import { isMt5LocalConfigured, mt5Connect, mt5Status } from "./mt5local/client";
import {
  deleteMtAccount,
  getMtAccount,
  getMtAccountMeta,
  saveMtAccount,
  updateMtAccountStatus,
} from "./store";
import type { MtPlatform } from "./markets/types";

export const mtConnectSchema = z.object({
  platform: z.enum(["mt4", "mt5"]),
  server: z.string().min(2, "اسم السيرفر مطلوب."),
  login: z.string().min(1, "رقم الحساب مطلوب."),
  password: z.string().min(1, "كلمة المرور مطلوبة."),
});

export type MtConnectInput = z.infer<typeof mtConnectSchema>;

/** Connect MT4/MT5 via MetaApi or self-hosted mt5local bridge. */
export async function connectMtAccount(userId: number, input: MtConnectInput) {
  const backend = getForexBackend();

  if (backend === "ea") {
    throw new Error(
      "خلفية الفوركس على EA — اربط MetaTrader عبر Expert Advisor من الإعدادات، لا عبر login/password.",
    );
  }

  const login = input.login.replace(/\D/g, "");
  if (!login) {
    throw new Error("رقم الحساب يجب أن يحتوي على أرقام فقط.");
  }

  if (backend === "mt5local") {
    if (!isMt5LocalConfigured()) {
      throw new Error("حاوية MT5 غير مفعّلة (MT5_BRIDGE_URL مفقود).");
    }
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
  }

  if (!isMetaApiConfigured()) {
    throw new Error("ربط الفوركس غير متاح حالياً. عيّن METAAPI_TOKEN أو استخدم EA.");
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
    name: `AiChart u${userId}`,
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
  const backend = getForexBackend();

  if (backend === "ea") {
    return { backend: "ea" as const, connected: false, online: false };
  }

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
      const status = await mt5Status();
      const online = Boolean(status.connected);
      await updateMtAccountStatus(userId, {
        state: online ? "DEPLOYED" : "UNDEPLOYED",
        connectionStatus: online ? "CONNECTED" : "DISCONNECTED",
        ...(status.account
          ? {
              balance: status.account.balance,
              equity: status.account.equity,
              currency: status.account.currency,
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
