import crypto from "crypto";
import type { NextRequest } from "next/server";
import { initDb, queryOne } from "./db";
import { ensureUserDefaults, setFlag } from "./store";
import { ApiError } from "./api";

/** Flag key holding the timestamp of the agent's last authenticated call. */
export const AGENT_LAST_SEEN_FLAG = "agent_last_seen";

/**
 * Single-user mode + service auth for the MCP agent bridge.
 *
 * The platform runs for one human operator. The Claude MCP server talks to the
 * bridge API (/api/agent/*) using a service token, never a browser session.
 */

/** Multi-user is the default; set AICHART_SINGLE_USER=1 for operator-only gate. */
export function isSingleUserMode(): boolean {
  return process.env.AICHART_SINGLE_USER === "1";
}

function serviceToken(): string | null {
  const raw = process.env.AICHART_SERVICE_TOKEN;
  if (!raw) return null;
  const token = raw.trim().replace(/\r$/, "");
  return token.length >= 16 ? token : null;
}

export function isAgentBridgeConfigured(): boolean {
  return serviceToken() !== null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function isValidAgentToken(provided: string | null | undefined): boolean {
  const expected = serviceToken();
  if (!expected || !provided?.trim()) return false;
  const normalized = provided.trim().replace(/\r$/, "");
  return timingSafeEqual(normalized, expected);
}

/**
 * Authenticates a bridge request via `Authorization: Bearer <token>` or the
 * `x-agent-token` header. Throws ApiError on failure.
 */
export function requireAgentAuth(req: NextRequest): void {
  const expected = serviceToken();
  if (!expected) {
    throw new ApiError(
      503,
      "جسر الوكيل غير مفعّل. عيّن AICHART_SERVICE_TOKEN (16 حرفاً على الأقل).",
    );
  }
  const header = req.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : null;
  const provided =
    bearer ??
    req.headers.get("x-agent-token") ??
    req.nextUrl.searchParams.get("token");
  if (!isValidAgentToken(provided)) {
    throw new ApiError(401, "توكن الوكيل غير صحيح.");
  }
  // Bridge pulse for the dashboard — fire and forget.
  setFlag(AGENT_LAST_SEEN_FLAG, new Date().toISOString()).catch(() => {});
}

let cachedAgentUserId: number | null = null;

/**
 * Resolves the single operator's user id for bridge calls:
 * AICHART_AGENT_USER_ID env override, else the first admin account.
 */
export async function resolveAgentUserId(): Promise<number> {
  if (cachedAgentUserId !== null) return cachedAgentUserId;

  const fromEnv = Number(process.env.AICHART_AGENT_USER_ID);
  if (Number.isInteger(fromEnv) && fromEnv > 0) {
    cachedAgentUserId = fromEnv;
    await ensureUserDefaults(fromEnv);
    return fromEnv;
  }

  await initDb();
  const row = await queryOne(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1",
  );
  const id = row ? Number((row as { id: number }).id) : 1;
  cachedAgentUserId = id;
  await ensureUserDefaults(id);
  return id;
}
