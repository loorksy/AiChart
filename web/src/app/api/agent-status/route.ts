import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import {
  countOpenTrades,
  getFlag,
  getLimits,
  getSettings,
  isMasterKillOn,
  logAudit,
  todayRealizedPnlUsd,
  updateSettings,
} from "@/lib/store";
import { AGENT_LAST_SEEN_FLAG, isAgentBridgeConfigured } from "@/lib/agentAuth";
import { TRADING_MODES } from "@/lib/types";

/** Web UI (session auth): live agent/bridge status for the dashboard bar. */
export async function GET() {
  try {
    const user = await requireUser();
    const settings = await getSettings(user.id);
    const limits = await getLimits(user.id);

    return NextResponse.json({
      bridgeConfigured: isAgentBridgeConfigured(),
      lastSeen: await getFlag(AGENT_LAST_SEEN_FLAG),
      mode: settings.mode,
      canAuto: limits.can_execute === 1,
      killSwitch: {
        master: await isMasterKillOn(),
        user: settings.kill_switch === 1,
      },
      openTrades: await countOpenTrades(user.id),
      todayPnlUsd: await todayRealizedPnlUsd(user.id),
    });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({ mode: z.enum(TRADING_MODES) });

/** Quick mode switch from the dashboard bar. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const limits = await getLimits(user.id);

    if (body.mode === "auto" && limits.can_execute !== 1) {
      return NextResponse.json(
        { error: "وضع التنفيذ التلقائي يتطلب صلاحية تنفيذ من الإدارة." },
        { status: 403 },
      );
    }

    await updateSettings(user.id, { mode: body.mode });
    await logAudit(user.id, "mode_change", `mode=${body.mode} (dashboard)`);
    return NextResponse.json({ ok: true, mode: body.mode });
  } catch (e) {
    return handleError(e);
  }
}
