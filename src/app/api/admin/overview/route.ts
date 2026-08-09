import { NextResponse } from "next/server";
import { handleError, requireAdmin } from "@/lib/api";
import { initDb } from "@/lib/db";
import { getAdminRole, permissionsForRole } from "@/lib/adminRoles";
import {
  loadOverview,
  overviewWindow,
  resolvePeriod,
  type AdminOverviewResponse,
} from "@/lib/admin/overviewQueries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { AdminOverviewResponse };

/**
 * KPIs, the revenue/cost/profit series and the top earners for the platform
 * overview. Any admin may call it; the money sections require profit_read and
 * come back as null / [] otherwise — the numbers are never computed, so an
 * unauthorised admin cannot infer them from timing or from zeroed fields.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    await initDb();

    const permissions = permissionsForRole(await getAdminRole(admin.id));
    const days = resolvePeriod(new URL(request.url).searchParams.get("days"));

    if (!permissions.includes("profit_read")) {
      const w = overviewWindow(days);
      const body: AdminOverviewResponse = {
        ok: true,
        days,
        range: { from: w.from, to: w.to },
        permissions,
        kpis: null,
        series: [],
        leaders: [],
      };
      return NextResponse.json(body);
    }

    const data = await loadOverview(days);
    const body: AdminOverviewResponse = {
      ok: true,
      days,
      range: data.range,
      permissions,
      kpis: data.kpis,
      series: data.series,
      leaders: data.leaders,
    };
    return NextResponse.json(body);
  } catch (err) {
    return handleError(err);
  }
}
