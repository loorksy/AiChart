import { NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { getForexBackend } from "@/lib/brokers/forexBackend";
import { getMetaApi, getRpcConnection } from "@/lib/metaapi/client";
import { getMtAccount, getMtAccountMeta, updateMtAccountStatus } from "@/lib/store";

/** Live MetaTrader connection status via MetaApi. */
export async function GET() {
  try {
    const user = await requireUser();
    if (getForexBackend() !== "metaapi") {
      return NextResponse.json({ backend: "ea", connected: false });
    }

    const meta = await getMtAccountMeta(user.id);
    if (!meta) {
      return NextResponse.json({
        backend: "metaapi",
        connected: false,
        online: false,
      });
    }

    const row = await getMtAccount(user.id);
    if (!row?.metaapi_account_id) {
      return NextResponse.json({
        backend: "metaapi",
        connected: false,
        online: false,
      });
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
          const conn = await getRpcConnection(user.id, row.metaapi_account_id);
          const info = await conn.getAccountInformation();
          balance = Number(info.balance) || balance;
          equity = Number(info.equity) || equity;
          currency = info.currency ?? currency;
        } catch {
          /* RPC may still be syncing */
        }
      }

      await updateMtAccountStatus(user.id, {
        state: account.state,
        connectionStatus: account.connectionStatus,
        balance,
        equity,
        currency,
      });

      const online =
        account.state === "DEPLOYED" &&
        account.connectionStatus === "CONNECTED";

      return NextResponse.json({
        backend: "metaapi",
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
      });
    } catch {
      return NextResponse.json({
        backend: "metaapi",
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
      });
    }
  } catch (err) {
    return handleError(err);
  }
}
