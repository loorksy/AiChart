import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { handleError, requirePaidAccess } from "@/lib/api";

export const runtime = "nodejs";

function resolveEaBinaryPath(): string | null {
  const fromEnv = process.env.EA_MT5_BINARY_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates = [
    path.join(process.cwd(), "..", "ea", "mt5", "AiChartBridge.ex5"),
    path.join(process.cwd(), "ea", "mt5", "AiChartBridge.ex5"),
    path.join(process.cwd(), "..", "..", "ea", "mt5", "AiChartBridge.ex5"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function GET(_req: NextRequest) {
  try {
    await requirePaidAccess();
    const filePath = resolveEaBinaryPath();
    if (!filePath) {
      return NextResponse.json(
        { error: "ملف AiChartBridge.ex5 غير متوفر على الخادم." },
        { status: 404 },
      );
    }
    const buf = fs.readFileSync(filePath);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="AiChartBridge.ex5"',
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
