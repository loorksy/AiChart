import { NextRequest, NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/api";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { initDb, queryOne } from "@/lib/db";
import { buildAccountSummary } from "@/lib/billing/accountSummary";
import type { PublicUser } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Account status for BOTH surfaces that ask on a user's behalf: the web
 * session (cookie) and the MCP bridge (service token + user headers) — the
 * model reads the same status/balance the badge shows, instead of
 * discovering the account state only at a refusal.
 */
async function resolveUser(
  req: NextRequest,
): Promise<Pick<PublicUser, "id" | "role" | "status">> {
  const hasBridgeAuth =
    req.headers.get("x-agent-token") != null ||
    req.headers.get("authorization")?.startsWith("Bearer ") === true;
  if (!hasBridgeAuth) return requireUser();
  const userId = await resolveBridgeUserId(req);
  const row = await queryOne<Pick<PublicUser, "id" | "role" | "status">>(
    "SELECT id, role, status FROM users WHERE id = ?",
    [userId],
  );
  if (!row) throw new Error("bridge user not found");
  return row;
}

export async function GET(req: NextRequest) {
  try {
    await initDb();
    const user = await resolveUser(req);
    const summary = await buildAccountSummary(user);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return handleError(err);
  }
}
