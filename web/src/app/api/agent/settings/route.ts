import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getLimits, getSettings, logAudit, updateSettings } from "@/lib/store";

const patchSchema = z
  .object({
    active_market: z.enum(["crypto", "forex"]),
    futures_enabled: z.boolean(),
    default_leverage: z.number().min(1).max(125),
  })
  .partial();

/** Bridge: read trading settings relevant to the agent. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const settings = await getSettings(userId);
    return NextResponse.json({
      active_market: settings.active_market ?? "crypto",
      futures_enabled: Boolean(settings.futures_enabled),
      default_leverage: settings.default_leverage ?? 1,
      mode: settings.mode,
      execution_env_preference: settings.execution_env_preference ?? "demo",
    });
  } catch (err) {
    return handleError(err);
  }
}

/** Bridge: patch a limited subset of operator settings. */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const input = patchSchema.parse(await req.json());
    if (Object.keys(input).length === 0) {
      return NextResponse.json(
        { error: "لا توجد حقول للتحديث." },
        { status: 400 },
      );
    }

    const limits = await getLimits(userId);
    const patch: Record<string, unknown> = { ...input };

    if (typeof input.futures_enabled === "boolean") {
      patch.futures_enabled = input.futures_enabled ? 1 : 0;
    }
    if (typeof input.default_leverage === "number") {
      const leverageCap =
        limits.max_leverage_cap && limits.max_leverage_cap > 0
          ? limits.max_leverage_cap
          : 10;
      patch.default_leverage = Math.min(input.default_leverage, leverageCap);
    }

    await updateSettings(userId, patch);
    await logAudit(userId, "agent_settings_patch", Object.keys(input).join(","));

    const settings = await getSettings(userId);
    return NextResponse.json({
      ok: true,
      active_market: settings.active_market ?? "crypto",
      futures_enabled: Boolean(settings.futures_enabled),
      default_leverage: settings.default_leverage ?? 1,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
