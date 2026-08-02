import { z } from "zod";
import { withBridge } from "@/lib/bridge";
import { getEaConnection } from "@/lib/eaStore";
import {
  eaReconnectFlagKey,
  eaResyncCandlesFlagKey,
} from "@/lib/eaTradeCommands";
import { resolveForexBackendForUser, setFlag } from "@/lib/store";
import { ApiError } from "@/lib/api";

const bodySchema = z.object({
  resync_candles: z.boolean().optional(),
});

/** Bridge: request EA reconnect on next heartbeat (optional candle resync). */
export const POST = withBridge(async ({ req, userId }) => {
  const backend = await resolveForexBackendForUser(userId);
  if (backend !== "ea") {
    // Nothing to reconnect: there is no EA in this account's path at all.
    throw new ApiError(
      400,
      "إعادة اتصال EA لا تنطبق — حسابك مربوط عبر المنصة (MetaApi/جسر MT5).",
    );
  }
  const conn = await getEaConnection(userId);
  if (!conn || conn.status === "revoked") {
    throw new ApiError(404, "لا يوجد ربط EA — ولّد رمزاً من الإعدادات.");
  }

  const body = bodySchema.parse(await req.json().catch(() => ({})));

  await setFlag(eaReconnectFlagKey(userId), "1");
  if (body.resync_candles) {
    await setFlag(eaResyncCandlesFlagKey(userId), "1");
  }

  return {
    requested: true,
    reconnect: true,
    resync_candles: Boolean(body.resync_candles),
    message:
      "Reconnect flag set — EA will re-sync on next heartbeat (within ~30s).",
  };
}, { routeKey: "/api/agent/ea/reconnect" });
