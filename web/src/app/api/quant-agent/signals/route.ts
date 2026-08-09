import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import {
  listSignalEvents,
  SIGNAL_EVENT_LIST_MAX_LIMIT,
  type SignalDecision,
} from "@/lib/quantAgent/signalEventStore";

/**
 * Quant Agent SIGNAL HISTORY — every monitor fire this user has had, newest
 * first. Read-only and strictly user-scoped.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/routes/strategy_notifications.py`
 * (`GET /strategies/notifications`), the closest thing upstream has to a
 * fired-signal feed.
 *
 * What changed: upstream's feed is a NOTIFICATION table, so it only ever
 * contains fires that included the in-app `browser` channel — a Telegram-only
 * alert is absent from it by construction, and a failed send is absent from it
 * entirely. This reads the append-only signal-event log instead, which records
 * the fire itself and carries the per-channel delivery outcome, so a Telegram
 * send that failed is visible here rather than nowhere. Upstream's scoping
 * predicate is also a disjunction over strategy ownership that falls back to
 * `user_id` only when the row has no strategy; this is `user_id = ?`, full
 * stop.
 *
 * There is deliberately no POST and no DELETE. A signal event is a record of
 * something that already happened and was already sent; a log a user can
 * rewrite is not evidence of anything.
 *
 * Follows `api/quant-agent/analysis/route.ts`'s convention:
 * `resolveQuantAgentUserId` → parse query → work → `NextResponse.json`.
 */

export const runtime = "nodejs";

const DECISIONS = new Set<SignalDecision>(["BUY", "SELL", "HOLD"]);

/** List the caller's own signal events (`?limit=&cursor=&symbol=&monitorId=&decision=`). */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const url = new URL(req.url);

    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam == null ? undefined : Number(limitParam);
    if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
      throw new ApiError(400, "Invalid limit.");
    }

    const monitorParam = url.searchParams.get("monitorId");
    const parsedMonitorId = monitorParam == null ? null : Number(monitorParam);
    if (parsedMonitorId != null && (!Number.isInteger(parsedMonitorId) || parsedMonitorId <= 0)) {
      throw new ApiError(400, "Invalid monitorId.");
    }

    const decisionParam = url.searchParams.get("decision")?.toUpperCase() as
      | SignalDecision
      | undefined;
    if (decisionParam && !DECISIONS.has(decisionParam)) {
      throw new ApiError(400, "Invalid decision.");
    }

    // `monitorId` is only a FILTER on an already user-scoped query — passing
    // someone else's monitor id narrows the caller's own rows to none, it
    // never widens the result to theirs.
    const page = await listSignalEvents(userId, {
      limit:
        parsedLimit === undefined ? undefined : Math.min(parsedLimit, SIGNAL_EVENT_LIST_MAX_LIMIT),
      cursor: url.searchParams.get("cursor"),
      symbol: url.searchParams.get("symbol"),
      monitorId: parsedMonitorId,
      decision: decisionParam ?? null,
    });

    return NextResponse.json({ signals: page.items, nextCursor: page.nextCursor });
  } catch (err) {
    return handleError(err);
  }
}
