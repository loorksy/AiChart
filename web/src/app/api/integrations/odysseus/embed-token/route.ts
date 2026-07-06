import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { requireAgentAuth } from "@/lib/agentAuth";
import { mintOdysseusEmbedToken } from "@/lib/integrations/odysseusEmbedToken";
import { buildOdysseusEmbedUrl } from "@/lib/integrations/odysseus";

const bodySchema = z.object({
  email: z.string().email(),
  sessionId: z.string().optional(),
  symbol: z.string().optional(),
  interval: z.string().optional(),
  source: z.enum(["oanda", "ea"]).optional(),
});

/** Mint a short-lived embed token for Odysseus iframe (service auth only). */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const body = bodySchema.parse(await req.json());
    const token = mintOdysseusEmbedToken(body.email, body.sessionId);
    if (!token) {
      return NextResponse.json(
        { error: "Embed tokens require AICHART_SERVICE_TOKEN" },
        { status: 503 },
      );
    }
    const embedUrl = buildOdysseusEmbedUrl({
      symbol: body.symbol,
      interval: body.interval,
      source: body.source,
      sessionId: body.sessionId,
      token,
    });
    return NextResponse.json({ token, embedUrl, expiresInSec: 900 });
  } catch (e) {
    return handleError(e);
  }
}
