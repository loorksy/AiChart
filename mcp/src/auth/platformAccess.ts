export type McpAccessReason =
  | "invalid"
  | "pending"
  | "suspended"
  | "expired"
  | "needs_credentials"
  | "subscription_required";

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

export function mcpLoginErrorMessage(
  reason?: McpAccessReason,
  locale: "ar" | "en" = "ar",
): string {
  const en = locale === "en";
  switch (reason) {
    case "pending":
      return en
        ? "Your account is awaiting admin approval."
        : "حسابك بانتظار موافقة الإدارة.";
    case "suspended":
      return en ? "Your account is suspended." : "حسابك موقوف.";
    case "expired":
      return en
        ? "Your account access expired. Contact admin to renew."
        : "انتهت صلاحية حسابك. تواصل مع الإدارة للتجديد.";
    case "needs_credentials":
      return en
        ? "Complete MCP email and password from AiChart (/complete-profile)."
        : "أكمل بريد وكلمة مرور MCP من لوحة AiChart (/complete-profile).";
    case "subscription_required":
      return en
        ? "Full AiChart access is required for MCP. Contact @aswadtr on Telegram to subscribe."
        : "الوصول الكامل مطلوب لـ MCP. تواصل عبر تيليجرام @aswadtr لتفعيل الاشتراك.";
    case "invalid":
    default:
      return en ? "Invalid sign-in details." : "بيانات الدخول غير صحيحة.";
  }
}
