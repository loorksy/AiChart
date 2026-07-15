import { NextResponse } from "next/server";
import { releaseIdentity } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * Liveness probe — process is up and serving. Dependency-free and public so
 * load balancers / container orchestrators / Docker HEALTHCHECK can hit it
 * cheaply without auth or DB access. Exposes the exact running release
 * identity so a stale build/container/process is externally detectable.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    ts: new Date().toISOString(),
    ...releaseIdentity(),
  });
}
