import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getSettings, logAudit, updateSettings } from "@/lib/store";

const schema = z.object({
  /** true = enforce riskGuard (safe default); false = full-autonomous. */
  enabled: z.boolean(),
});

/**
 * Bridge: per-user master toggle for riskGuard enforcement.
 *
 * OFF puts the account in "full autonomous" mode — the agent + committee are the
 * sole authority over buy/sell/size/SL/TP, with NO risk/permission gates. The
 * non-negotiable execution safety still applies (platform emergency kill, the
 * user's own kill switch, futures mandatory SL + leverage cap, "can't risk more
 * than you have"). Reversible at any time by toggling back on.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    await updateSettings(userId, { risk_guard_enabled: body.enabled ? 1 : 0 });
    await logAudit(
      userId,
      "risk_guard_toggle",
      body.enabled ? "enabled" : "disabled(full-autonomous)",
    );

    const settings = await getSettings(userId);
    return NextResponse.json({
      ok: true,
      risk_guard_enabled: settings.risk_guard_enabled !== 0,
    });
  } catch (e) {
    return handleError(e);
  }
}

/** Bridge: read the current riskGuard enforcement state. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const settings = await getSettings(userId);
    return NextResponse.json({
      ok: true,
      risk_guard_enabled: settings.risk_guard_enabled !== 0,
    });
  } catch (e) {
    return handleError(e);
  }
}
