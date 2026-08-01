import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { initDb } from "@/lib/db";
import { permissionsForRole, requireAdminWith } from "@/lib/adminRoles";
import {
  loadOverviewUsers,
  redactUserRows,
  type AdminOverviewUsersResponse,
} from "@/lib/admin/overviewQueries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { AdminOverviewUsersResponse };

/**
 * Read-only user roster for the overview table. users_read is the entry gate;
 * balances and costs additionally need billing_read, revenue and profit need
 * profit_read. Every mutation still lives in the existing users panel.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { adminRole } = await requireAdminWith("users_read");
    await initDb();

    const permissions = permissionsForRole(adminRole);
    const money = permissions.includes("billing_read");
    const profit = permissions.includes("profit_read");

    const body: AdminOverviewUsersResponse = {
      ok: true,
      rows: redactUserRows(await loadOverviewUsers(), { money, profit }),
      money_visible: money,
      profit_visible: profit,
    };
    return NextResponse.json(body);
  } catch (err) {
    return handleError(err);
  }
}
