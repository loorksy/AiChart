import { queueEaListSymbols } from "@/lib/eaAgentCommands";
import { getEaSymbolList } from "@/lib/mt5SymbolMap";
import { getCached, setCached } from "@/lib/bridge/cache";
import type { EaBrokerSymbol } from "@/lib/types";

const CACHE_RESOURCE = "ea:symbols:all";
const CACHE_TTL_MS = 5 * 60_000;
const PAGE_LIMIT = 400;
const MAX_PAGES = 15; // up to 6000 symbols

export interface BrokerSymbolInfo {
  symbol: string;
  digits: number;
  description: string;
}

/**
 * The user's ENTIRE broker symbol universe via EA `list_symbols` (v4.02+),
 * cached 5 minutes. Falls back to the heartbeat Market Watch list for older
 * EAs that don't know the command yet.
 */
export async function getAllBrokerSymbols(
  userId: number,
): Promise<{ symbols: BrokerSymbolInfo[]; source: "ea_all" | "market_watch" }> {
  const hit = await getCached<{ symbols: BrokerSymbolInfo[]; source: "ea_all" | "market_watch" }>(
    userId,
    CACHE_RESOURCE,
  );
  if (hit.fromCache && hit.value.symbols.length > 0) return hit.value;

  const out: BrokerSymbolInfo[] = [];
  const seen = new Set<string>();

  try {
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const ack = await queueEaListSymbols(
        userId,
        { all: true, offset, limit: PAGE_LIMIT },
        15_000,
      );
      if (!ack.ok || !ack.result) throw new Error(ack.reason ?? "list_symbols failed");
      const rows = (ack.result.symbols ?? []) as EaBrokerSymbol[];
      for (const r of rows) {
        const name = String(r.s ?? "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({
          symbol: name,
          digits: Number(r.d) || 5,
          description: String(r.n ?? ""),
        });
      }
      const total = Number(ack.result.total) || 0;
      offset += rows.length;
      if (rows.length === 0 || offset >= total) break;
    }
  } catch {
    /* old EA — fall back below */
  }

  if (out.length > 0) {
    const value = { symbols: out, source: "ea_all" as const };
    await setCached(userId, CACHE_RESOURCE, value, CACHE_TTL_MS);
    return value;
  }

  // Fallback: Market Watch symbols from the latest EA heartbeat.
  const watch = await getEaSymbolList(userId);
  const value = {
    symbols: watch.map((s) => ({ symbol: s, digits: 5, description: "" })),
    source: "market_watch" as const,
  };
  if (value.symbols.length > 0) {
    await setCached(userId, CACHE_RESOURCE, value, 60_000);
  }
  return value;
}
