import { getForexBackend } from "@/lib/brokers/forexBackend";
import { getEaConnection, parseEaSymbolSpecs } from "@/lib/eaStore";
import { resolveLiveForexMid } from "@/lib/eaLiveState";
import { forexCanonicalKey, resolveMt5Symbol } from "@/lib/mt5SymbolMap";
import { mt5Price } from "@/lib/mt5local/client";

/** Live mid price for a forex symbol (resolves broker suffix via EA heartbeat). */
export async function getForexLiveMid(
  userId: number,
  symbol: string,
): Promise<number> {
  if (getForexBackend() === "mt5local") {
    try {
      const resolved = (await resolveMt5Symbol(userId, symbol)) ?? symbol;
      const { bid, ask } = await mt5Price(resolved);
      if (bid && ask) return (bid + ask) / 2;
      return bid || ask || 0;
    } catch {
      return 0;
    }
  }

  const conn = await getEaConnection(userId);
  if (!conn) return 0;

  const resolved = (await resolveMt5Symbol(userId, symbol)) ?? symbol;
  const key = forexCanonicalKey(symbol);
  const spec = parseEaSymbolSpecs(conn.symbol_specs_json).find(
    (s) =>
      s.symbol?.toUpperCase() === resolved.toUpperCase() ||
      forexCanonicalKey(s.symbol ?? "") === key,
  );

  const resolvedMid = await resolveLiveForexMid(
    userId,
    resolved,
    spec?.bid,
    spec?.ask,
  );
  return resolvedMid.price;
}
