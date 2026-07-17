import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError, requirePaidAccess } from "@/lib/api";
import {
  buildTradingDnaReport,
  getLatestTradingDnaSnapshot,
  getPersonaForSnapshot,
  renderTradingDnaHtml,
  renderTradingDnaJson,
  renderTradingDnaPdf,
} from "@/lib/tradingDna";

/** Read-only evidence report export. Supported formats: json, html and pdf. */
export async function GET(request: NextRequest) {
  try {
    const user = await requirePaidAccess();
    const snapshot = await getLatestTradingDnaSnapshot(user.id);
    if (!snapshot) throw new ApiError(404, "Trading DNA snapshot not found.");
    const persona = await getPersonaForSnapshot(user.id, snapshot.snapshotId);
    if (!persona) throw new ApiError(404, "Trading persona not found.");
    const report = buildTradingDnaReport(snapshot, persona);
    const format = request.nextUrl.searchParams.get("format") ?? "json";
    if (format === "html") {
      return new NextResponse(renderTradingDnaHtml(report), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (format === "pdf") {
      return new NextResponse(new Uint8Array(renderTradingDnaPdf(report)), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="aichart-trading-dna.pdf"',
        },
      });
    }
    if (format !== "json") throw new ApiError(400, "Unsupported report format.");
    return new NextResponse(renderTradingDnaJson(report), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return handleError(error);
  }
}
