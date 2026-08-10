import { z } from "zod";
import { withBridge } from "@/lib/bridge";
import { getUserMetaApiConnection, resolveUserBrokerSymbol } from "@/lib/brokers/metaApiDirect";

const schema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  volume: z.number().positive(),
  open_price: z.number().positive(),
});

/** Bridge: required margin for a hypothetical order, computed by MetaApi. */
export const POST = withBridge(async ({ req, userId }) => {
  const body = schema.parse(await req.json());
  const symbol = await resolveUserBrokerSymbol(userId, body.symbol);
  const conn = await getUserMetaApiConnection(userId);
  const margin = await conn.calculateMargin({
    symbol,
    type: body.side === "buy" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
    volume: body.volume,
    openPrice: body.open_price,
  });
  return { symbol, ...margin };
}, { routeKey: "/api/agent/mt/margin" });
