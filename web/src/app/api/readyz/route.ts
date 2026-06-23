import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { metrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

async function checkDb(): Promise<boolean> {
  try {
    await query("SELECT 1 AS ok");
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<"ok" | "down" | "disabled"> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return "disabled";
  try {
    const { default: IORedis } = await import("ioredis");
    const client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      lazyConnect: true,
    });
    try {
      await client.connect();
      await client.ping();
      return "ok";
    } finally {
      await client.quit().catch(() => {});
    }
  } catch {
    return "down";
  }
}

/**
 * Readiness probe — checks the dependencies required to serve traffic (DB, and
 * Redis when configured). Returns 503 when a hard dependency is down so the
 * orchestrator stops routing to this instance.
 */
export async function GET() {
  const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
  const ready = db && redis !== "down";
  metrics.brokerUp.set({ kind: "_db" }, db ? 1 : 0);
  return NextResponse.json(
    { status: ready ? "ready" : "degraded", checks: { db, redis } },
    { status: ready ? 200 : 503 },
  );
}
