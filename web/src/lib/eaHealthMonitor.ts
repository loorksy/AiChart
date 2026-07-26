import { getEaConnection, getEaOnlineState, setEaStatus } from "./eaStore";
import {
  eaReconnectFlagKey,
  eaResyncCandlesFlagKey,
} from "./eaTradeCommands";
import { getFlag, setFlag } from "./store";
import { suspendAutoOnDisconnect } from "./agent/tradeMode";

export type EaHealthStatus = "online" | "offline";

export interface EaHealthSnapshot {
  status: EaHealthStatus;
  changedAt: string;
  lastHeartbeatAt: string | null;
}

export interface EaHealthEvent {
  type: "ea_offline" | "ea_recovered";
  detail: string;
}

const STATE_PREFIX = "ea_health_monitor_state:";

function stateKey(userId: number): string {
  return `${STATE_PREFIX}${userId}`;
}

function parseState(raw: string | null): EaHealthSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EaHealthSnapshot>;
    if (parsed.status !== "online" && parsed.status !== "offline") return null;
    return {
      status: parsed.status,
      changedAt:
        typeof parsed.changedAt === "string"
          ? parsed.changedAt
          : new Date(0).toISOString(),
      lastHeartbeatAt:
        typeof parsed.lastHeartbeatAt === "string"
          ? parsed.lastHeartbeatAt
          : null,
    };
  } catch {
    return null;
  }
}

export function decideEaHealthEvent(
  previous: EaHealthStatus | null,
  current: EaHealthStatus,
  missedHeartbeats: number,
): EaHealthEvent | null {
  if (current === "offline" && previous !== "offline") {
    return {
      type: "ea_offline",
      detail:
        `⚠️ انقطع اتصال MetaTrader/EA بعد ${missedHeartbeats} نبضات مفقودة. ` +
        "تم تفعيل إعادة الاتصال وإعادة مزامنة الشموع تلقائياً؛ التنفيذ متوقف حتى عودة نبض حديث، " +
        "وأُوقف الوضع التلقائي إن كان مفعّلاً — ستُسأل عنه من جديد بعد عودة الاتصال.",
    };
  }
  if (current === "online" && previous === "offline") {
    return {
      type: "ea_recovered",
      detail:
        "✅ عاد اتصال MetaTrader/EA وأصبح النبض حديثاً. أُعيدت مزامنة الجسر؛ ستظل فحوص الجاهزية مطلوبة قبل أي تنفيذ.",
    };
  }
  return null;
}

/**
 * Persisted transition monitor: one alert per outage/recovery, plus automatic
 * reconnect/resync flags. It never opens, closes, or changes a trade decision.
 */
export async function monitorEaBridgeHealth(
  userId: number,
): Promise<EaHealthEvent | null> {
  const connection = await getEaConnection(userId);
  if (!connection || connection.status === "revoked") return null;

  const onlineState = getEaOnlineState(userId, connection.last_heartbeat_at);
  const current: EaHealthStatus = onlineState.online ? "online" : "offline";
  const previous = parseState(await getFlag(stateKey(userId)));
  const event = decideEaHealthEvent(
    previous?.status ?? null,
    current,
    onlineState.missedHeartbeats,
  );

  if (current === "offline") {
    await Promise.all([
      setFlag(eaReconnectFlagKey(userId), "1"),
      setFlag(eaResyncCandlesFlagKey(userId), "1"),
      setEaStatus(userId, "offline"),
      // Standing execution authorisation was given for a live connection. With
      // the account gone it is suspended rather than left armed, so a silent
      // reconnect hours later cannot start placing orders the operator has
      // stopped expecting.
      suspendAutoOnDisconnect(userId).catch(() => false),
    ]);
  }

  if (!previous || previous.status !== current) {
    const snapshot: EaHealthSnapshot = {
      status: current,
      changedAt: new Date().toISOString(),
      lastHeartbeatAt: connection.last_heartbeat_at,
    };
    await setFlag(stateKey(userId), JSON.stringify(snapshot));
  }
  return event;
}
