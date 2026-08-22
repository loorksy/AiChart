import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyChartHostToken } from "@/lib/chart/hostToken";
import {
  ackPlatformCapture,
  completePlatformCapture,
  listPendingPlatformCaptures,
  notePlatformTabPoll,
} from "@/lib/chart/liveCapture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf.subarray(0, 4).equals(PNG_MAGIC);
}

/**
 * The PLATFORM tab's RPC — the /chart-host page inside the chart-host
 * container polls here exactly like an operator tab polls
 * /api/chart/live-capture. Authenticated by the chart-host HMAC token (the
 * page has no browser session), never by cookies; an embed or user token
 * verifies to null here.
 */
function tokenFrom(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return req.nextUrl.searchParams.get("token");
}

export async function GET(req: NextRequest) {
  const claims = verifyChartHostToken(tokenFrom(req));
  if (!claims) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  notePlatformTabPoll();
  return NextResponse.json({ requests: listPendingPlatformCaptures() });
}

const ackSchema = z.object({
  action: z.literal("ack"),
  request_id: z.string().min(4).max(80),
});

const uploadSchema = z.object({
  action: z.literal("upload"),
  request_id: z.string().min(4).max(80),
  images: z
    .array(
      z.object({
        label: z.enum(["context", "zoom"]),
        image_base64: z.string().min(32),
      }),
    )
    .min(1)
    .max(4),
  drawings_rendered: z.number().int().min(0).max(64),
  studies_rendered: z.number().int().min(0).max(32),
});

export async function POST(req: NextRequest) {
  const claims = verifyChartHostToken(tokenFrom(req));
  if (!claims) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  notePlatformTabPoll();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const ack = ackSchema.safeParse(body);
  if (ack.success) {
    const ok = ackPlatformCapture(ack.data.request_id);
    if (!ok) return NextResponse.json({ error: "unknown_request" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const upload = uploadSchema.safeParse(body);
  if (!upload.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const images: { label: string; buffer: Buffer }[] = [];
  for (const image of upload.data.images) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(image.image_base64, "base64");
    } catch {
      return NextResponse.json({ error: "upload_failed" }, { status: 400 });
    }
    if (!isPng(buffer)) {
      return NextResponse.json({ error: "upload_failed" }, { status: 400 });
    }
    images.push({ label: image.label, buffer });
  }
  const done = completePlatformCapture({
    requestId: upload.data.request_id,
    images,
    drawingsRendered: upload.data.drawings_rendered,
    studiesRendered: upload.data.studies_rendered,
  });
  if (!done.ok) {
    return NextResponse.json({ error: done.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
