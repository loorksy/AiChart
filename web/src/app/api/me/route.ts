import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getAccessBlockReason,
  hasPlatformAccess,
} from "@/lib/platformAccess";
import { needsMcpCredentials } from "@/lib/userCredentials";
import {
  getSettings,
  getLimits,
  getTodayUsage,
  countPendingIntents,
  countUnreadAlerts,
} from "@/lib/store";
import { getEntitlementForUser } from "@/lib/subscription/entitlement";
import { getAdminRole, permissionsForRole } from "@/lib/adminRoles";
import { AICHART_PLAN } from "@/lib/subscription/plan";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "غير مصرّح. يرجى تسجيل الدخول." },
      { status: 401 },
    );
  }
  const limits = await getLimits(user.id);
  const used = await getTodayUsage(user.id);
  const limit = limits.claude_quota;
  const platformAccess = hasPlatformAccess(user);
  const accessBlockReason = platformAccess ? null : getAccessBlockReason(user);
  const entitlement = await getEntitlementForUser(user);
  // Cosmetic only: lets the shell hide admin destinations the console would
  // refuse. Every admin API still re-checks with requireAdminWith.
  const adminPermissions =
    user.role === "admin" ? permissionsForRole(await getAdminRole(user.id)) : [];
  return NextResponse.json({
    user,
    needs_mcp_credentials: needsMcpCredentials(user),
    admin_permissions: adminPermissions,
    platform_access: platformAccess,
    access_block_reason: accessBlockReason,
    entitlement: {
      access: entitlement.access,
      planStatus: entitlement.planStatus,
      trialUsed: entitlement.trialUsed,
      trialRemaining: entitlement.trialRemaining,
      trialLimit: entitlement.trialLimit,
      expiresAt: entitlement.expiresAt,
      plan: {
        titleEn: AICHART_PLAN.titleEn,
        titleAr: AICHART_PLAN.titleAr,
        regularPriceUsd: AICHART_PLAN.regularPriceUsd,
        promotionalPriceUsd: AICHART_PLAN.promotionalPriceUsd,
        telegramUrl: AICHART_PLAN.telegramUrl,
        telegramHandle: AICHART_PLAN.telegramHandle,
      },
    },
    settings: await getSettings(user.id),
    limits,
    quota: {
      used,
      limit,
      remaining: Math.max(0, limit - used),
    },
    pendingIntents: await countPendingIntents(user.id),
    unreadAlerts: await countUnreadAlerts(user.id),
  });
}
