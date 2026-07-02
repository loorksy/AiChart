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

export function handleError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع.";
  return NextResponse.json({ error: message }, { status: 500 });
}
