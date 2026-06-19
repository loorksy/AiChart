import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  getScalpSession,
  getSettings,
  logAudit,
  updateSettings,
} from "@/lib/store";

/** User dashboard: current scalp permission settings + agent session status. */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const [settings, session] = await Promise.all([
      getSettings(user.id),
      getScalpSession(user.id),
    ]);
    return NextResponse.json({
      scalp_enabled: settings.scalp_enabled,
      scalp_execution_mode: settings.scalp_execution_mode,
      session: session?.active ? session : null,
    });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({
  /** "settings" = update the permission/mode only (agent handles sessions). */
  action: z.literal("settings"),
  scalp_enabled: z.number().int().min(0).max(1),
  scalp_execution_mode: z.enum(["paper", "live"]),
});

/**
 * User dashboard: save scalp permission settings.
 * The agent (via MCP) starts/stops the actual scalp session in conversation —
 * this endpoint only grants or revokes that permission.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = schema.parse(await req.json());

    await updateSettings(user.id, {
      scalp_enabled: body.scalp_enabled,
      scalp_execution_mode: body.scalp_execution_mode,
    });

    await logAudit(
      user.id,
      "scalp_settings",
      `enabled=${body.scalp_enabled} mode=${body.scalp_execution_mode}`,
    );

    const settings = await getSettings(user.id);
    return NextResponse.json({
      ok: true,
      scalp_enabled: settings.scalp_enabled,
      scalp_execution_mode: settings.scalp_execution_mode,
    });
  } catch (e) {
    return handleError(e);
  }
}
