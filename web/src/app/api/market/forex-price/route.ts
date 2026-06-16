import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getForexBackend } from "@/lib/brokers/forexBackend";
import { getEaConnection, isHeartbeatFresh, parseEaSymbolSpecs } from "@/lib/eaStore";
import { getRpcConnection } from "@/lib/metaapi/client";
import { getMtAccount, getMtAccountMeta } from "@/lib/store";

/** Live forex price — MetaApi or EA heartbeat depending on backend. */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const symbol = (req.nextUrl.searchParams.get("symbol") || "EURUSD")
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, "");

    if (getForexBackend() === "metaapi") {
      const meta = await getMtAccountMeta(user.id);
      if (!meta) {
        return NextResponse.json({
          connected: false,
          online: false,
          symbol,
          price: null,
        });
      }
      if (!meta.online) {
        return NextResponse.json({
          connected: true,
          online: false,
          symbol,
          price: null,
          updated_at: meta.updated_at,
        });
      }

      const row = await getMtAccount(user.id);
      if (!row?.metaapi_account_id) {
        return NextResponse.json({
          connected: false,
          online: false,
          symbol,
          price: null,
        });
      }

      try {
        const conn = await getRpcConnection(user.id, row.metaapi_account_id);
        const px = await conn.getSymbolPrice(symbol, false);
        const bid = Number(px.bid);
        const ask = Number(px.ask);
        const price =
          Number.isFinite(bid) && Number.isFinite(ask)
            ? (bid + ask) / 2
            : bid || ask || null;
        return NextResponse.json({
          connected: true,
          online: true,
          symbol,
          price,
          bid: Number.isFinite(bid) ? bid : null,
          ask: Number.isFinite(ask) ? ask : null,
          updated_at: new Date().toISOString(),
        });
      } catch {
        return NextResponse.json({
          connected: true,
          online: false,
          symbol,
          price: null,
          updated_at: meta.updated_at,
        });
      }
    }

    const conn = await getEaConnection(user.id);
    if (!conn) {
      return NextResponse.json({ connected: false, online: false, symbol, price: null });
    }
    const online = isHeartbeatFresh(conn.last_heartbeat_at);
    const spec = parseEaSymbolSpecs(conn.symbol_specs_json).find(
      (s) => s.symbol?.toUpperCase() === symbol,
    );
    const bid = spec?.bid ?? null;
    const ask = spec?.ask ?? null;
    const price =
      bid != null && ask != null ? (Number(bid) + Number(ask)) / 2 : (bid ?? ask ?? null);

    return NextResponse.json({
      connected: true,
      online,
      symbol,
      price,
      bid,
      ask,
      updated_at: conn.last_heartbeat_at,
    });
  } catch (err) {
    return handleError(err);
  }
}
