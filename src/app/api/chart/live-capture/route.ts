import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { getChartLayoutById } from "@/lib/store";
import {
  ackLiveCapture,
  completeLiveCapture,
  listPendingLiveCaptures,
} from "@/lib/chart/liveCapture";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf.subarray(0, 4).equals(PNG_MAGIC);
}

/** GET: pending live-capture requests for this layout (browser poll). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const layoutId = req.nextUrl.searchParams.get("layout_id") ?? "";
    if (!/^[A-Za-z0-9]{8,16}$/.test(layoutId)) {
      return NextResponse.json({ requests: [] });
    }
    const layout = await getChartLayoutById(layoutId, user.id);
    if (!layout) {
      return NextResponse.json({ error: "layout not found" }, { status: 404 });
    }
    return NextResponse.json({
      requests: listPendingLiveCaptures(user.id, layoutId),
    });
  } catch (err) {
    return handleError(err);
  }
}

const ackSchema = z.object({
  action: z.literal("ack"),
  request_id: z.string().min(4).max(80),
  layout_id: z.string().regex(/^[A-Za-z0-9]{8,16}$/),
});

const jsonUploadSchema = z.object({
  action: z.literal("upload"),
  request_id: z.string().min(4).max(80),
  layout_id: z.string().regex(/^[A-Za-z0-9]{8,16}$/),
  image_base64: z.string().min(32),
  drawings_rendered: z.number().int().min(0).max(64),
  studies_rendered: z.number().int().min(0).max(32),
});

/**
 * POST: ack a request, or upload the PNG (JSON base64 or multipart
 * `preparedImage` — the TradingView snapshot_url field name).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const layoutId = String(form.get("layout_id") ?? "");
      const requestId = String(form.get("request_id") ?? form.get("requestId") ?? "");
      const file = form.get("preparedImage") ?? form.get("image");
      if (!/^[A-Za-z0-9]{8,16}$/.test(layoutId)) {
        return NextResponse.json({ error: "layout not found" }, { status: 404 });
      }
      const layout = await getChartLayoutById(layoutId, user.id);
      if (!layout) {
        return NextResponse.json({ error: "layout not found" }, { status: 404 });
      }
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "upload_failed" }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (!isPng(buffer)) {
        return NextResponse.json({ error: "upload_failed" }, { status: 400 });
      }
      const drawingsRendered = Number(form.get("drawings_rendered") ?? 0);
      const studiesRendered = Number(form.get("studies_rendered") ?? 0);
      const done = completeLiveCapture({
        requestId,
        userId: user.id,
        layoutId,
        buffer,
        drawingsRendered: Number.isFinite(drawingsRendered) ? drawingsRendered : 0,
        studiesRendered: Number.isFinite(studiesRendered) ? studiesRendered : 0,
      });
      if (!done.ok) {
        const status = done.error === "layout_not_owned" ? 403 : 400;
        return NextResponse.json({ error: done.error }, { status });
      }
      return NextResponse.json({ ok: true });
    }

    const body = await req.json();
    const ack = ackSchema.safeParse(body);
    if (ack.success) {
      const layout = await getChartLayoutById(ack.data.layout_id, user.id);
      if (!layout) {
        return NextResponse.json({ error: "layout not found" }, { status: 404 });
      }
      const ok = ackLiveCapture(user.id, ack.data.request_id);
      if (!ok) return NextResponse.json({ error: "unknown_request" }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    const upload = jsonUploadSchema.safeParse(body);
    if (!upload.success) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const layout = await getChartLayoutById(upload.data.layout_id, user.id);
    if (!layout) {
      return NextResponse.json({ error: "layout not found" }, { status: 404 });
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(upload.data.image_base64, "base64");
    } catch {
      return NextResponse.json({ error: "upload_failed" }, { status: 400 });
    }
    if (!isPng(buffer)) {
      return NextResponse.json({ error: "upload_failed" }, { status: 400 });
    }
    const done = completeLiveCapture({
      requestId: upload.data.request_id,
      userId: user.id,
      layoutId: upload.data.layout_id,
      buffer,
      drawingsRendered: upload.data.drawings_rendered,
      studiesRendered: upload.data.studies_rendered,
    });
    if (!done.ok) {
      const status = done.error === "layout_not_owned" ? 403 : 400;
      return NextResponse.json({ error: done.error }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
