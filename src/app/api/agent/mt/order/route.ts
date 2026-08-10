import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { getUserMetaApiConnection } from "@/lib/brokers/metaApiDirect";

/** Bridge: a single pending order by id, straight from MetaApi. */
export const GET = withBridge(async ({ req, userId }) => {
  const orderId = req.nextUrl.searchParams.get("order_id")?.trim();
  if (!orderId) throw new ApiError(400, "order_id مطلوب.");
  const conn = await getUserMetaApiConnection(userId);
  const order = await conn.getOrder(orderId);
  return { order };
}, { routeKey: "/api/agent/mt/order" });
