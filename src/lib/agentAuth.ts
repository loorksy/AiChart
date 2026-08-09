import crypto from "crypto";
import type { NextRequest } from "next/server";
import { initDb, queryOne } from "./db";
import { ensureUserDefaults, setFlag } from "./store";
import { ApiError } from "./api";
import {
  accessBlockMessage,
  getAccessBlockReason,
  hasPlatformAccess,
} from "./platformAccess";
import { needsMcpCredentials } from "./userCredentials";
import type { UserRow } from "./types";
import { userRowToPublicUser } from "./userSelect";

/** Flag key holding the timestamp of the agent's last authenticated call. */
export const AGENT_LAST_SEEN_FLAG = "agent_last_seen";

export function agentLastSeenFlagKey(userId: number): string {
  return `agent_last_seen:${userId}`;
}

/**
 * Service auth for the MCP agent bridge (/api/agent/*).
 * Multi-user: OAuth email + HMAC headers from aichart-mcp.
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

export function bridgeUserSig(email: string): string | null {
  const token = serviceToken();
  if (!token) return null;
  return crypto
    .createHmac("sha256", token)
    .update(email.toLowerCase())
    .digest("hex");
}

function verifyBridgeUserSig(email: string, sig: string | null): boolean {
  const expected = bridgeUserSig(email);
  if (!expected || !sig?.trim()) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig.trim(), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
}

function touchAgentLastSeen(userId: number): void {
  const iso = new Date().toISOString();
  void setFlag(AGENT_LAST_SEEN_FLAG, iso).catch(() => {});
  void setFlag(agentLastSeenFlagKey(userId), iso).catch(() => {});
}

let cachedAgentUserId: number | null = null;

/**
 * Legacy single-operator id (AICHART_SINGLE_USER=1 or dev only).
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

/**
 * Resolves the MCP OAuth user for bridge calls (multi-user production path).
 */
export async function resolveBridgeUserId(req: NextRequest): Promise<number> {
  requireAgentAuth(req);

  if (isSingleUserMode()) {
    const userId = await resolveAgentUserId();
    touchAgentLastSeen(userId);
    return userId;
  }

  const email = req.headers.get("x-aichart-user-email")?.trim().toLowerCase();
  const sig = req.headers.get("x-aichart-user-sig");
  if (!email) {
    throw new ApiError(
      400,
      "X-Aichart-User-Email مطلوب لطلبات جسر MCP.",
    );
  }
  if (!verifyBridgeUserSig(email, sig)) {
    throw new ApiError(403, "توقيع هوية المستخدم غير صحيح.");
  }

  await initDb();
  const row = await queryOne<UserRow>(
    "SELECT * FROM users WHERE email = ? LIMIT 1",
    [email],
  );
  if (!row) {
    throw new ApiError(404, "المستخدم غير موجود.");
  }

  const user = userRowToPublicUser(row);
  if (needsMcpCredentials(user)) {
    throw new ApiError(
      403,
      "أكمل بريد وكلمة مرور MCP من /complete-profile.",
    );
  }
  if (!hasPlatformAccess(user)) {
    const reason = getAccessBlockReason(user) ?? "pending";
    throw new ApiError(403, accessBlockMessage(reason));
  }

  const { getEntitlementForUser } = await import("@/lib/subscription/entitlement");
  const { subscriptionRequiredMessage } = await import("@/lib/subscription/trialQuota");
  const entitlement = await getEntitlementForUser(user);
  if (!entitlement.isAdmin && !entitlement.hasPaidAccess && entitlement.access !== "trial") {
    throw new ApiError(403, subscriptionRequiredMessage("ar"));
  }

  touchAgentLastSeen(user.id);
  return user.id;
}
