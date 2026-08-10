import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { getUserMetaApiConnection } from "@/lib/brokers/metaApiDirect";

/** Bridge: a single open position by id, straight from MetaApi. */
export const GET = withBridge(async ({ req, userId }) => {
  const positionId = req.nextUrl.searchParams.get("position_id")?.trim();
  if (!positionId) throw new ApiError(400, "position_id مطلوب.");
  const conn = await getUserMetaApiConnection(userId);
  const position = await conn.getPosition(positionId);
  return { position };
}, { routeKey: "/api/agent/mt/position" });
