import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getSettings } from "@/lib/store";
import { DISPLAY_NAME_AR } from "@/lib/gold";
import { oandaConfigured } from "@/lib/markets/oanda";

/**
 * Console status.
 *
 * The broker-connection and execution-environment blocks are gone with the
 * execution layer — there is no account to connect and no environment to be
 * live or demo in. What is left is whether the platform's own data feed is up
 * and whether the user has linked Telegram.
 */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const settings = await getSettings(user.id);

    return NextResponse.json({
      instrument: DISPLAY_NAME_AR,
      marketData: {
        source: "OANDA",
        available: oandaConfigured(),
      },
      telegram: {
        linked: Boolean(settings.telegram_chat_id),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
