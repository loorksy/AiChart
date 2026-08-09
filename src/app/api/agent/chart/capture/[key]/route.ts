import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getChartCapture } from "@/lib/chartCaptureStore";

/** Bridge: fetch a cached chart PNG by key (Bearer or ?token= for Telegram MEDIA). */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  try {
    requireAgentAuth(req);
    const { key } = await ctx.params;
    const buffer = getChartCapture(key);
    if (!buffer) {
      return NextResponse.json(
        { error: "انتهت صلاحية الصورة أو المفتاح غير صالح." },
        { status: 404 },
      );
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
