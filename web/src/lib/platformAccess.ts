import type { PublicUser, Role, UserStatus } from "./types";

export type AccessBlockReason = "pending" | "suspended" | "expired";

export type UserWithAccess = PublicUser & {
  access_expires_at?: string | null;
};

export function hasPlatformAccess(user: UserWithAccess): boolean {
  if (user.role === "admin") return true;
  if (user.status === "suspended") return false;
  if (user.status !== "active") return false;
  if (!user.access_expires_at) return false;
  return new Date(user.access_expires_at).getTime() > Date.now();
}

export function getAccessBlockReason(
  user: UserWithAccess,
): AccessBlockReason | null {
  if (user.role === "admin") return null;
  if (user.status === "suspended") return "suspended";
  if (user.status !== "active") return "pending";
  if (!user.access_expires_at) return "pending";
  if (new Date(user.access_expires_at).getTime() <= Date.now()) return "expired";
  return null;
}

export function accessBlockMessage(reason: AccessBlockReason): string {
  switch (reason) {
    case "pending":
      return "حسابك بانتظار موافقة الإدارة.";
    case "suspended":
      return "حسابك موقوف. تواصل مع الإدارة.";
    case "expired":
      return "انتهت صلاحية حسابك. تواصل مع الإدارة للتجديد.";
  }
}

export const DEFAULT_ACCESS_DAYS = 30;

export function computeAccessExpiresAt(
  accessDays: number,
  currentExpiresAt: string | null | undefined,
  renew: boolean,
): string {
  const now = Date.now();
  const baseMs = renew && currentExpiresAt
    ? Math.max(now, new Date(currentExpiresAt).getTime())
    : now;
  return new Date(baseMs + accessDays * 24 * 60 * 60 * 1000).toISOString();
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function accessDaysRemaining(
  access_expires_at: string | null | undefined,
): number | null {
  if (!access_expires_at) return null;
  const expires = new Date(access_expires_at);
  if (Number.isNaN(expires.getTime())) return null;
  const ms = expires.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / MS_PER_DAY);
}

export function formatAccessRemaining(
  access_expires_at: string | null | undefined,
): string {
  if (!access_expires_at) return "—";
  const days = accessDaysRemaining(access_expires_at);
  if (days === null) return "—";
  if (days === 0) return "منتهٍ";
  if (days === 1) return "متبقي يوم واحد";
  if (days === 2) return "متبقي يومان";
  if (days >= 3 && days <= 10) return `متبقي ${days} أيام`;
  return `متبقي ${days} يوماً`;
}

export function formatAccessExpiryLabel(
  access_expires_at: string | null | undefined,
): string {
  const remaining = formatAccessRemaining(access_expires_at);
  if (!access_expires_at || remaining === "—" || remaining === "منتهٍ") {
    return remaining;
  }
  const date = new Date(access_expires_at).toLocaleDateString("ar-EG", {
    dateStyle: "medium",
  });
  return `${remaining} (${date})`;
}
