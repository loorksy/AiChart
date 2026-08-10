import { withBridge } from "@/lib/bridge";
import { getUserMetaApiConnection } from "@/lib/brokers/metaApiDirect";

/** Bridge: every pending order on the account, straight from MetaApi. */
export const GET = withBridge(async ({ userId }) => {
  const conn = await getUserMetaApiConnection(userId);
  const orders = await conn.getOrders();
  return { orders, count: orders.length };
}, { routeKey: "/api/agent/mt/orders" });
