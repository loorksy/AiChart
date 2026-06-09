import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getSettings,
  getLimits,
  getBinanceAccountMeta,
  getTodayUsage,
  countPendingIntents,
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
  return NextResponse.json({
    user,
    settings: await getSettings(user.id),
    limits,
    binance: await getBinanceAccountMeta(user.id),
    quota: {
      used,
      limit,
      remaining: Math.max(0, limit - used),
    },
    pendingIntents: await countPendingIntents(user.id),
  });
}
