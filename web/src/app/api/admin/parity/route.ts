import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { buildParityReport } from "@/lib/agent/parityLog";

/**
 * Platform-vs-MCP decision parity (completion criterion 2).
 *
 * The criterion is not "the two surfaces never differ" — they will, constantly,
 * for legitimate reasons. It is that the count of differences with NO known cause
 * is zero, because an unexplained difference means the surfaces are not actually
 * running the same decision path.
 *
 * `unexplained` is therefore the number to watch, and it is returned first.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
    const report = await buildParityReport(
      Number.isFinite(limit) ? Math.max(1, Math.min(limit, 500)) : 100,
    );
    return NextResponse.json({
      unexplained: report.totals.unexplained,
      totals: report.totals,
      // Moments only one surface ever saw. Counted, not treated as agreement.
      unpaired: report.unpaired,
      entries: report.entries,
    });
  } catch (err) {
    return handleError(err);
  }
}
