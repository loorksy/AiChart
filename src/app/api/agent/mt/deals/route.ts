import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { getUserMetaApiConnection } from "@/lib/brokers/metaApiDirect";

/**
 * Bridge: executed MT5 deals, straight from MetaApi — by ticket, by
 * position, or across a time range. `mode` selects which MetaApi call runs.
 */
export const GET = withBridge(async ({ req, userId }) => {
  const params = req.nextUrl.searchParams;
  const mode = params.get("mode");
  const conn = await getUserMetaApiConnection(userId);

  if (mode === "ticket") {
    const ticket = params.get("ticket")?.trim();
    if (!ticket) throw new ApiError(400, "ticket مطلوب مع mode=ticket.");
    return conn.getDealsByTicket(ticket);
  }
  if (mode === "position") {
    const positionId = params.get("position_id")?.trim();
    if (!positionId) throw new ApiError(400, "position_id مطلوب مع mode=position.");
    return conn.getDealsByPosition(positionId);
  }
  if (mode === "range") {
    const fromRaw = params.get("from");
    const toRaw = params.get("to");
    if (!fromRaw || !toRaw) throw new ApiError(400, "from و to مطلوبان مع mode=range (ISO 8601).");
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new ApiError(400, "from/to يجب أن يكونا تاريخاً صالحاً (ISO 8601).");
    }
    const offset = params.get("offset") ? Number(params.get("offset")) : undefined;
    const limit = params.get("limit") ? Number(params.get("limit")) : undefined;
    return conn.getDealsByTimeRange(from, to, offset, limit);
  }
  throw new ApiError(400, "mode مطلوب: ticket أو position أو range.");
}, { routeKey: "/api/agent/mt/deals" });
