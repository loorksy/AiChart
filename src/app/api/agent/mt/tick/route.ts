import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { getUserMetaApiConnection, resolveUserBrokerSymbol } from "@/lib/brokers/metaApiDirect";

/** Bridge: the most recent tick for a symbol, straight from MetaApi. */
export const GET = withBridge(async ({ req, userId }) => {
  const symbolRaw = req.nextUrl.searchParams.get("symbol")?.trim();
  if (!symbolRaw) throw new ApiError(400, "symbol مطلوب.");
  const symbol = await resolveUserBrokerSymbol(userId, symbolRaw);
  const conn = await getUserMetaApiConnection(userId);
  const tick = await conn.getTick(symbol, false);
  return { symbol, tick };
}, { routeKey: "/api/agent/mt/tick" });
