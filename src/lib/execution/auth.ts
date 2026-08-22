/**
 * Who is pressing execute — resolved for BOTH surfaces that carry a human
 * press: the web session (cookie) and the MCP bridge (service token + user
 * HMAC headers, exactly like /api/agent/*). Presence of the bridge headers
 * selects the bridge path; anything else must be a signed-in user. There is
 * no third caller: nothing internal ever invokes the execution routes.
 */
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveBridgeUserId } from "@/lib/agentAuth";

export async function resolveExecutionUserId(req: NextRequest): Promise<number> {
  const hasBridgeAuth =
    req.headers.get("x-agent-token") != null ||
    req.headers.get("authorization")?.startsWith("Bearer ") === true;
  if (hasBridgeAuth) {
    return resolveBridgeUserId(req);
  }
  const user = await requireUser();
  return user.id;
}
