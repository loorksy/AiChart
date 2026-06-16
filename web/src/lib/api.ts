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
