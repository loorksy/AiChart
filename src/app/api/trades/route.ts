import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { listTrades, countOpenTrades } from "@/lib/store";

export async function GET() {
  try {
    const user = await requirePaidAccess();
    return NextResponse.json({
      trades: await listTrades(user.id, 50),
      openCount: await countOpenTrades(user.id),
    });
  } catch (err) {
    return handleError(err);
  }
}
