import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError } from "@/lib/api";
import { getQuantRecommendation, quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";

/** GET — single quant-agent recommendation detail proxy (§4). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!quantAgentServiceEnabled()) {
      throw new ApiError(503, "خدمة Quant Agent غير مفعّلة.");
    }
    const { id } = await params;
    const userId = await resolveQuantAgentUserId(req);
    const requestId = req.headers.get("x-request-id")?.trim() || randomUUID();

    const recommendation = await getQuantRecommendation({ userId, requestId }, id);
    if (!recommendation) {
      throw new ApiError(404, "التوصية غير موجودة.");
    }
    return NextResponse.json({ ok: true, recommendation });
  } catch (error) {
    return handleError(error);
  }
}
