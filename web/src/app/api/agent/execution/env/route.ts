import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  getExecutionEnvSnapshot,
  type ExecutionEnv,
} from "@/lib/executionEnv";
import { logAudit, updateSettings } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    return NextResponse.json(await getExecutionEnvSnapshot(userId));
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({
  preference: z.enum(["demo", "live"]),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const preference = body.preference as ExecutionEnv;

    await updateSettings(userId, { execution_env_preference: preference });
    await logAudit(userId, "agent_execution_env", `preference=${preference}`);

    const snap = await getExecutionEnvSnapshot(userId);

    return NextResponse.json({
      ok: true,
      preference,
      executionEnv: snap,
    });
  } catch (e) {
    return handleError(e);
  }
}
