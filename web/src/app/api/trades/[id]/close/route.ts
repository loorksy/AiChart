import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { closeOpenTrade } from "@/lib/tradeClose";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePaidAccess();
    const { id } = await params;
    const tradeId = Number(id);
    if (!Number.isFinite(tradeId) || tradeId <= 0) {
      return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
    }

    const result = await closeOpenTrade(user.id, tradeId);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason ?? "فشل الإغلاق." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      tradeId: result.tradeId,
      symbol: result.symbol,
      pnl: result.pnl,
    });
  } catch (err) {
    return handleError(err);
  }
}
