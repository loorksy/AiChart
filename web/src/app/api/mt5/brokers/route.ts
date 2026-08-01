import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import { getPlatformValueAsync } from "@/lib/platformConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V2-B (#96): live broker/server search for the connect wizard, proxied to
 * MetaApi's provisioning server-search. Requires METAAPI_TOKEN; without it
 * (or on upstream failure) the wizard falls back to manual server entry —
 * search is a convenience, never a gate.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, servers: [] });

  const token = await getPlatformValueAsync("METAAPI_TOKEN");
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "metaapi_not_configured", servers: [] },
      { status: 503 },
    );
  }

  try {
    const upstream = await fetch(
      `https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/servers/mt5?query=${encodeURIComponent(q)}`,
      { headers: { "auth-token": token }, signal: AbortSignal.timeout(8000) },
    );
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const data = (await upstream.json()) as unknown;
    const servers = Array.isArray(data)
      ? data
          .map((s) =>
            typeof s === "string"
              ? s
              : ((s as { name?: string }).name ?? null),
          )
          .filter((s): s is string => !!s)
          .slice(0, 20)
      : [];
    return NextResponse.json({ ok: true, servers });
  } catch {
    // Search failing must not block the wizard — manual entry always works.
    return NextResponse.json(
      { ok: false, error: "search_unavailable", servers: [] },
      { status: 502 },
    );
  }
}
