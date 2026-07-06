import { NextResponse } from "next/server";
import { checkRateLimit, clientKey, handleError } from "@/lib/api";
import { buildOdysseusManifest } from "@/lib/integrations/odysseus";

export async function GET(req: Request) {
  try {
    if (!checkRateLimit(`odysseus-manifest:${clientKey(req)}`, 120, 60_000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    return NextResponse.json(buildOdysseusManifest());
  } catch (e) {
    return handleError(e);
  }
}
