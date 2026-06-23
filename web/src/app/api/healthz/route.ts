import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe — process is up and serving. Dependency-free and public so
 * load balancers / container orchestrators / Docker HEALTHCHECK can hit it
 * cheaply without auth or DB access.
 */
export async function GET() {
  return NextResponse.json({ status: "ok", ts: new Date().toISOString() });
}
