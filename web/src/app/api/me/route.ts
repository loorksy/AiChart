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
  getBinanceAccountMeta,
  getTodayUsage,
  countPendingIntents,
  countUnreadAlerts,
} from "@/lib/store";

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
  return NextResponse.json({
    user,
    needs_mcp_credentials: needsMcpCredentials(user),
    platform_access: platformAccess,
    access_block_reason: accessBlockReason,
    settings: await getSettings(user.id),
    limits,
    binance: await getBinanceAccountMeta(user.id),
    quota: {
      used,
      limit,
      remaining: Math.max(0, limit - used),
    },
    pendingIntents: await countPendingIntents(user.id),
    unreadAlerts: await countUnreadAlerts(user.id),
  });
}
