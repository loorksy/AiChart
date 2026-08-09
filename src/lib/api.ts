import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import type { PublicUser } from "./types";
import {
  accessBlockMessage,
  getAccessBlockReason,
  hasPlatformAccess,
} from "./platformAccess";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "غير مصرّح. يرجى تسجيل الدخول.");
  if (user.status === "suspended") {
    throw new ApiError(403, "حسابك موقوف. تواصل مع الإدارة.");
  }
  return user;
}

/**
 * Returns the signed-in user, or null for guests (public browsing).
 * Suspended accounts are treated as guests (no elevated access).
 */
export async function getOptionalUser(): Promise<PublicUser | null> {
  const user = await getCurrentUser();
  if (!user || user.status === "suspended") return null;
  return user;
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Lightweight in-memory rate limit (per server instance) for public/guest
 * endpoints — enough to blunt casual scraping of the unauthenticated feed.
 * Returns true when the call is allowed.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  // Opportunistic sweep so the bucket map can't grow without bound under a
  // flood of distinct clients (each guest IP would otherwise leak an entry).
  if (rateBuckets.size > 5000) {
    for (const [k, b] of rateBuckets) {
      if (now >= b.resetAt) rateBuckets.delete(k);
    }
  }
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Best-effort client key for rate limiting (first X-Forwarded-For hop). */
export function clientKey(req: { headers: { get(name: string): string | null } }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function requireActiveUser(): Promise<PublicUser> {
  const user = await requireUser();
  if (user.status !== "active") {
    throw new ApiError(403, "حسابك بانتظار موافقة الإدارة لتفعيله.");
  }
  return user;
}

export async function requirePlatformAccess(): Promise<PublicUser> {
  const user = await requireUser();
  if (!hasPlatformAccess(user)) {
    const reason = getAccessBlockReason(user);
    throw new ApiError(
      403,
      reason ? accessBlockMessage(reason) : "الوصول غير متاح.",
    );
  }
  return user;
}

export async function requireAdmin(): Promise<PublicUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new ApiError(403, "صلاحيات الإدارة مطلوبة.");
  return user;
}

/**
 * Full paid (or admin) access — protects premium APIs and downloads.
 * Opening Telegram never grants this; only administrator activation does.
 */
export async function requirePaidAccess(): Promise<PublicUser> {
  const user = await requirePlatformAccess();
  const { getEntitlementForUser } = await import("@/lib/subscription/entitlement");
  const { subscriptionRequiredMessage } = await import("@/lib/subscription/trialQuota");
  const ent = await getEntitlementForUser(user);
  // A VALID trial (inside its hour, recommendations remaining) carries every
  // feature — the trial's caps are enforced where they bind (the clock in the
  // resolver, the count at recommendation creation), not by feature walls.
  if (ent.isAdmin || ent.hasPaidAccess || ent.access === "trial") return user;
  throw new ApiError(403, subscriptionRequiredMessage("ar"));
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Surface Research Service failures with code + HTTP status (never opaque).
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name?: string }).name === "ResearchServiceError"
  ) {
    const researchErr = err as unknown as {
      message: string;
      code?: string;
      status?: number;
    };
    const status =
      typeof researchErr.status === "number" &&
      researchErr.status >= 400 &&
      researchErr.status < 600
        ? researchErr.status
        : 502;
    return NextResponse.json(
      {
        error: researchErr.message,
        code: researchErr.code ?? "RESEARCH_SERVICE_ERROR",
        status,
      },
      { status },
    );
  }
  const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع.";
  return NextResponse.json({ error: message }, { status: 500 });
}
