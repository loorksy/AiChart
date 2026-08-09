import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { buildConsoleActiveTrades } from "@/lib/consoleActiveTrades";

/** Session-authenticated active trades with live PnL for the bridge console UI. */
export async function GET() {
  try {
    const user = await requirePaidAccess();
    const payload = await buildConsoleActiveTrades(user.id);
    return NextResponse.json(payload);
  } catch (e) {
    return handleError(e);
  }
}
