import { z } from "zod";
import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { getUserMetaApiConnection } from "@/lib/brokers/metaApiDirect";
import { createBrokerActionApprovalRequest } from "@/lib/brokers/brokerActionApproval";

const schema = z.object({ order_id: z.string().min(1) });

/**
 * Bridge: propose cancelling a pending order. Never applies anything itself
 * — creates a pending approval intent; only respond_approval (after the
 * operator approves) reaches the broker. Distinct from cancel_mt5_order,
 * which cancels immediately under standing authorisation.
 */
export const POST = withBridge(async ({ req, userId }) => {
  const body = schema.parse(await req.json());
  const conn = await getUserMetaApiConnection(userId);
  const order = await conn.getOrder(body.order_id).catch(() => null);
  if (!order) throw new ApiError(404, "الأمر المعلّق غير موجود.");
  const symbol = String(order.symbol ?? "UNKNOWN");

  const result = await createBrokerActionApprovalRequest(userId, {
    symbol,
    payload: { action: "cancel_order", params: { orderId: body.order_id } },
  });

  return {
    intentId: result.intentId,
    telegramDelivered: result.telegramDelivered,
    telegramReasonAr: result.reasonAr,
    message: "أُرسلت بطاقة الموافقة — لن يُلغى الأمر إلا بعد موافقة المشغّل.",
  };
}, { routeKey: "/api/agent/mt/propose-cancel-order" });
