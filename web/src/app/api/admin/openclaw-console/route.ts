import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";

function openClawConsoleUrl(): string | null {
  const base =
    process.env.OPENCLAW_CONSOLE_URL?.trim() ||
    "https://aichart.lork.cloud/openclaw/";
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!token || token.length < 8) return null;
  const url = new URL(base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

/** Admin-only: signed URL to OpenClaw Control Web UI (/openclaw/). */
export async function GET() {
  try {
    await requireAdmin();
    const webUiUrl = openClawConsoleUrl();
    if (!webUiUrl) {
      return NextResponse.json(
        {
          error:
            "OPENCLAW_GATEWAY_TOKEN غير مُعدّ في بيئة المنصة. شغّل infra/vps-openclaw-control-ui.sh على السيرفر.",
        },
        { status: 503 },
      );
    }
    const base =
      process.env.OPENCLAW_CONSOLE_URL?.trim() ||
      "https://aichart.lork.cloud/openclaw/";
    const wsUrl = base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    return NextResponse.json({
      webUiUrl,
      wsUrl: wsUrl.endsWith("/") ? wsUrl : `${wsUrl}/`,
      configured: true,
    });
  } catch (err) {
    return handleError(err);
  }
}
