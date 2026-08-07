import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { groupServersByBroker } from "@/lib/mt5/brokerSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live broker search for the connect wizard, proxied to MetaApi's
 * provisioning server-search and grouped the way the official MT5 app
 * presents it: one row per BROKER (the prefix shared by its server names),
 * carrying every server of that broker the search returned. The wizard's
 * second screen turns those servers into a dropdown.
 *
 * Requires METAAPI_TOKEN; without it (or on upstream failure) the wizard
 * falls back to manual server entry — search is a convenience, never a gate.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ ok: true, servers: [], brokers: [] });
  }

  const token = await getPlatformValueAsync("METAAPI_TOKEN");
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "metaapi_not_configured", servers: [], brokers: [] },
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
          .slice(0, 60)
      : [];
    return NextResponse.json({
      ok: true,
      // Flat list kept for compatibility with anything still reading it.
      servers: servers.slice(0, 20),
      brokers: groupServersByBroker(servers),
    });
  } catch {
    // Search failing must not block the wizard — manual entry always works.
    return NextResponse.json(
      { ok: false, error: "search_unavailable", servers: [], brokers: [] },
      { status: 502 },
    );
  }
}
