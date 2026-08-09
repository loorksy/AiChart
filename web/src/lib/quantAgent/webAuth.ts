import type { NextRequest } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { requireUser } from "@/lib/api";

/**
 * Resolves the caller's user id for the quant-agent web routes.
 *
 * Two callers hit these routes: the MCP/agent bridge (Authorization: Bearer
 * <AICHART_SERVICE_TOKEN> + X-Aichart-User-Email — the same resolveBridgeUserId
 * pattern `/api/agent/backtest` uses) generating or listing on the agent's
 * behalf, and the signed-in browser UI reading the shared feed via its session
 * cookie. Quant Agent recommendations are symbol-scoped, not account-scoped
 * (engineering plan §4 — "خلاصة مشتركة"), so any signed-in user may read them;
 * only presence of an Authorization/bridge header routes to the stricter
 * bridge check.
 */
export async function resolveQuantAgentUserId(req: NextRequest): Promise<number> {
  const hasBridgeAuth = Boolean(
    req.headers.get("authorization")?.trim() || req.headers.get("x-agent-token")?.trim(),
  );
  if (hasBridgeAuth) {
    return resolveBridgeUserId(req);
  }
  const user = await requireUser();
  return user.id;
}
