import { z } from "zod";
import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { getUserMetaApiConnection } from "@/lib/brokers/metaApiDirect";
import { createBrokerActionApprovalRequest } from "@/lib/brokers/brokerActionApproval";

const schema = z.object({
  order_id: z.string().min(1),
  open_price: z.number().positive().optional(),
  stop_loss: z.number().positive().optional(),
  take_profit: z.number().positive().optional(),
}).refine(
  (b) => b.open_price != null || b.stop_loss != null || b.take_profit != null,
  { message: "لا يوجد أي تعديل مطلوب (open_price أو stop_loss أو take_profit)." },
);

/**
 * Bridge: propose modifying a pending order's price/SL/TP. Never applies
 * anything itself — creates a pending approval intent, exactly like
 * request_approval, and only respond_approval (after the operator approves)
 * reaches the broker.
 */
export const POST = withBridge(async ({ req, userId }) => {
  const body = schema.parse(await req.json());
  const conn = await getUserMetaApiConnection(userId);
  const order = await conn.getOrder(body.order_id).catch(() => null);
  if (!order) throw new ApiError(404, "الأمر المعلّق غير موجود.");
  const symbol = String(order.symbol ?? "UNKNOWN");

  const result = await createBrokerActionApprovalRequest(userId, {
    symbol,
    payload: {
      action: "modify_order",
      params: {
        orderId: body.order_id,
        openPrice: body.open_price,
        stopLoss: body.stop_loss,
        takeProfit: body.take_profit,
      },
    },
  });

  return {
    intentId: result.intentId,
    telegramDelivered: result.telegramDelivered,
    telegramReasonAr: result.reasonAr,
    message: "أُرسلت بطاقة الموافقة — لن يُعدَّل الأمر إلا بعد موافقة المشغّل.",
  };
}, { routeKey: "/api/agent/mt/propose-modify-order" });
