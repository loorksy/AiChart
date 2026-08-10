/**
 * Direct MetaApi RPC reads/writes beyond what the platform's own trade flow
 * needs — full account browsing (positions, orders, history, deals, server
 * time, margin) plus the pending-order execution actions in Phase 5.
 *
 * MetaApi-only: the self-hosted mt5local bridge exposes none of this surface,
 * so every function here throws a clear Arabic error for an mt5local account
 * rather than silently returning empty data.
 */
import { getMtAccount } from "@/lib/store";
import { getRpcConnection, type MetaApiRpcConnection } from "@/lib/metaapi/client";
import { resolveBrokerSymbol } from "@/lib/markets/symbolCatalogue";

export async function getUserMetaApiConnection(
  userId: number,
): Promise<MetaApiRpcConnection> {
  const account = await getMtAccount(userId);
  if (!account?.metaapi_account_id || account.metaapi_account_id === "mt5local") {
    throw new Error(
      "هذه الميزة متاحة فقط لحساب MetaTrader مربوط عبر MetaApi السحابي — اربط حسابك من الإعدادات.",
    );
  }
  return getRpcConnection(userId, account.metaapi_account_id);
}

/** Canonical symbol → the linked account's own broker spelling. */
export async function resolveUserBrokerSymbol(
  userId: number,
  symbol: string,
): Promise<string> {
  return resolveBrokerSymbol(userId, symbol.trim());
}
