import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getForexBackend } from "@/lib/brokers/forexBackend";
import { getEaConnection, isHeartbeatFresh } from "@/lib/eaStore";
import { getForexLiveMid } from "@/lib/markets/forexPrice";
import { resolveMt5Symbol } from "@/lib/mt5SymbolMap";
import { getRpcConnection } from "@/lib/metaapi/client";
import { getMtAccount, getMtAccountMeta } from "@/lib/store";
import {
  fetchOandaPricing,
  oandaAccountId,
  oandaConfigured,
} from "@/lib/markets/oanda";

/** Live forex price — OANDA (when configured) → MetaApi or EA/mt5local. */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const symbol = (req.nextUrl.searchParams.get("symbol") || "EURUSD")
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, "");

    // Owner decision: market data (incl. live price) from OANDA when configured.
    if (oandaConfigured() && oandaAccountId()) {
      try {
        const [q] = await fetchOandaPricing([symbol]);
        if (q && q.mid != null) {
          return NextResponse.json({
            connected: true,
            online: q.tradeable,
            symbol,
            price: q.mid,
            bid: q.bid,
            ask: q.ask,
            updated_at: new Date().toISOString(),
          });
        }
      } catch {
        /* fall through to MetaApi / EA */
      }
    }

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
        const resolved =
          (await resolveMt5Symbol(user.id, symbol)) ?? symbol;
        const conn = await getRpcConnection(user.id, row.metaapi_account_id);
        const px = await conn.getSymbolPrice(resolved, false);
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
    const price = await getForexLiveMid(user.id, symbol);

    return NextResponse.json({
      connected: true,
      online,
      symbol,
      price: price > 0 ? price : null,
      updated_at: conn.last_heartbeat_at,
    });
  } catch (err) {
    return handleError(err);
  }
}
