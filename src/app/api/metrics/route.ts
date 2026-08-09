import { NextRequest, NextResponse } from "next/server";
import { metrics, renderMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * Prometheus scrape endpoint. Optionally protected by METRICS_TOKEN (Bearer or
 * ?token=) so it can be exposed without leaking internal stats; when unset it is
 * open (intended to sit on a private network / behind the infra firewall).
 */
export async function GET(req: NextRequest) {
  const token = process.env.METRICS_TOKEN?.trim();
  if (token) {
    const auth = req.headers.get("authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const qp = req.nextUrl.searchParams.get("token");
    if (bearer !== token && qp !== token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const body = await renderMetrics();
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": metrics.registry.contentType },
  });
}
