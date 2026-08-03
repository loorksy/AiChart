/**
 * Trade management, routed to the backend the account is actually on.
 *
 * `modify_sl_tp`, `close_partial` and `cancel_mt5_order` are offered to the
 * agent unconditionally. Each action runs on its own backend, and where a
 * backend genuinely cannot perform one, it says so immediately instead of
 * failing slowly.
 */
import { getMtAccount, getMtAccountMeta, resolveForexBackendForUser } from "@/lib/store";
import { getRpcConnection } from "@/lib/metaapi/client";
import { mt5Close } from "@/lib/mt5local/client";

export interface TradeManagementResult {
  ok: boolean;
  backend: "metaapi" | "mt5local";
  command_id?: number;
  result?: unknown;
  reason?: string;
}

/** MetaApi addresses positions by id; MT tickets are those ids as strings. */
function positionId(ticket: number): string {
  return String(ticket);
}

async function metaApiConnection(userId: number) {
  const account = await getMtAccount(userId);
  if (!account?.metaapi_account_id || account.metaapi_account_id === "mt5local") {
    throw new Error("لا يوجد حساب MetaTrader مربوط عبر المنصة.");
  }
  return getRpcConnection(userId, account.metaapi_account_id);
}

export async function modifyStopsForUser(
  userId: number,
  input: { ticket: number; stopLoss: number; takeProfit?: number },
): Promise<TradeManagementResult> {
  const backend = await resolveForexBackendForUser(userId);

  if (backend === "metaapi") {
    try {
      const conn = await metaApiConnection(userId);
      const result = await conn.modifyPosition(
        positionId(input.ticket),
        input.stopLoss,
        input.takeProfit,
      );
      return { ok: true, backend, result };
    } catch (e) {
      return {
        ok: false,
        backend,
        reason: e instanceof Error ? e.message : "تعذّر تعديل الأوامر عبر MetaApi.",
      };
    }
  }

  return {
    ok: false,
    backend,
    reason:
      "جسر MT5 المستضاف لا يوفّر تعديل وقف الخسارة/الهدف — أغلق الصفقة أو عدّلها من المنصة مباشرة.",
  };
}

export async function closePartiallyForUser(
  userId: number,
  input: { ticket: number; lots: number },
): Promise<TradeManagementResult> {
  const backend = await resolveForexBackendForUser(userId);

  if (backend === "metaapi") {
    try {
      const conn = await metaApiConnection(userId);
      const result = await conn.closePositionPartially(
        positionId(input.ticket),
        input.lots,
      );
      return { ok: true, backend, result };
    } catch (e) {
      return {
        ok: false,
        backend,
        reason: e instanceof Error ? e.message : "تعذّر الإغلاق الجزئي عبر MetaApi.",
      };
    }
  }

  // The bridge closes whole positions only; a partial close would have to be
  // reported as done while leaving the position untouched, which is worse than
  // refusing it.
  return {
    ok: false,
    backend,
    reason: "جسر MT5 المستضاف يدعم الإغلاق الكامل فقط — الإغلاق الجزئي غير متاح.",
  };
}

export async function cancelOrderForUser(
  userId: number,
  input: { ticket: number },
): Promise<TradeManagementResult> {
  const backend = await resolveForexBackendForUser(userId);

  if (backend === "metaapi") {
    try {
      const conn = await metaApiConnection(userId);
      const result = await conn.cancelOrder(positionId(input.ticket));
      return { ok: true, backend, result };
    } catch (e) {
      return {
        ok: false,
        backend,
        reason: e instanceof Error ? e.message : "تعذّر إلغاء الأمر عبر MetaApi.",
      };
    }
  }

  try {
    const meta = await getMtAccountMeta(userId);
    if (!meta) {
      return { ok: false, backend, reason: "لا يوجد حساب MetaTrader مربوط." };
    }
    // The bridge is multi-account; every call is pinned to this user's login.
    const res = await mt5Close(
      { login: meta.login, server: meta.server },
      { ticket: input.ticket },
    );
    return { ok: res.ok, backend, result: res, reason: res.errors?.[0] };
  } catch (e) {
    return {
      ok: false,
      backend,
      reason: e instanceof Error ? e.message : "تعذّر إلغاء الأمر عبر جسر MT5.",
    };
  }
}
