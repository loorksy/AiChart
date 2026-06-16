export type McpAccessReason =
  | "invalid"
  | "pending"
  | "suspended"
  | "expired"
  | "needs_credentials";

export interface PlatformVerifyResult {
  ok: boolean;
  email?: string;
  accessExpiresAt?: string | null;
  reason?: McpAccessReason;
}

export function accessTtlDays(
  accessExpiresAt: string | null | undefined,
  maxDays: number,
): number {
  if (!accessExpiresAt) return maxDays;
  const ms = new Date(accessExpiresAt).getTime() - Date.now();
  if (ms <= 0) return 1;
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return Math.max(1, Math.min(maxDays, days));
}

export function mcpLoginErrorMessage(reason?: McpAccessReason): string {
  switch (reason) {
    case "pending":
      return "حسابك بانتظار موافقة الإدارة.";
    case "suspended":
      return "حسابك موقوف.";
    case "expired":
      return "انتهت صلاحية حسابك. تواصل مع الإدارة للتجديد.";
    case "needs_credentials":
      return "أكمل بريد وكلمة مرور MCP من لوحة AiChart (/complete-profile).";
    case "invalid":
    default:
      return "بيانات الدخول غير صحيحة.";
  }
}
