import { z } from "zod";
import { withBridge } from "@/lib/bridge";
import { resolveUserBrokerSymbol } from "@/lib/brokers/metaApiDirect";
import { createBrokerActionApprovalRequest } from "@/lib/brokers/brokerActionApproval";

const schema = z.object({ symbol: z.string().min(1) });

/**
 * Bridge: propose closing every open position on a symbol — including ones
 * not opened through this platform (no local `trades` row required, unlike
 * close_trade). Never applies anything itself — creates a pending approval
 * intent; only respond_approval (after the operator approves) reaches the
 * broker.
 */
export const POST = withBridge(async ({ req, userId }) => {
  const body = schema.parse(await req.json());
  const symbol = await resolveUserBrokerSymbol(userId, body.symbol);

  const result = await createBrokerActionApprovalRequest(userId, {
    symbol,
    payload: { action: "close_position_by_symbol", params: { symbol } },
  });

  return {
    intentId: result.intentId,
    telegramDelivered: result.telegramDelivered,
    telegramReasonAr: result.reasonAr,
    message: "أُرسلت بطاقة الموافقة — لن تُغلق الصفقات إلا بعد موافقة المشغّل.",
  };
}, { routeKey: "/api/agent/mt/propose-close-by-symbol" });
