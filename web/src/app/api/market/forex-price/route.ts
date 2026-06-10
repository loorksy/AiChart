import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { getEaConnection, isHeartbeatFresh, parseEaSymbolSpecs } from "@/lib/eaStore";

/** Live forex price for a symbol, sourced from the EA's last heartbeat. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const symbol = (req.nextUrl.searchParams.get("symbol") || "EURUSD")
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, "");

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
