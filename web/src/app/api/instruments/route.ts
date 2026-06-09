import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { searchBinanceInstruments } from "@/lib/binanceSymbols";

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const q = (
      request.nextUrl.searchParams.get("q") ??
      request.nextUrl.searchParams.get("search") ??
      ""
    ).trim();

    const { instruments, total } = await searchBinanceInstruments(q, 200);

    const wrapped = request.nextUrl.searchParams.get("wrapped") === "1";
    if (wrapped) {
      return NextResponse.json({ instruments, total });
    }
    return NextResponse.json(instruments);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ";
    const status = msg.includes("غير مصرّح") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
