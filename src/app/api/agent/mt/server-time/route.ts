import { withBridge } from "@/lib/bridge";
import { getUserMetaApiConnection } from "@/lib/brokers/metaApiDirect";

/** Bridge: the broker's own server time, straight from MetaApi. */
export const GET = withBridge(async ({ userId }) => {
  const conn = await getUserMetaApiConnection(userId);
  return conn.getServerTime();
}, { routeKey: "/api/agent/mt/server-time" });
