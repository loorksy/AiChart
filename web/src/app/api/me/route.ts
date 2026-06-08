import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSettings, getLimits, getBinanceAccountMeta } from "@/lib/store";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  return NextResponse.json({
    user,
    settings: getSettings(user.id),
    limits: getLimits(user.id),
    binance: getBinanceAccountMeta(user.id),
  });
}
