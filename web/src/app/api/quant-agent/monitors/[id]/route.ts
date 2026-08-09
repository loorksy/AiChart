import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { deleteMonitor, updateMonitor } from "@/lib/quantAgent/monitorStore";

const webhookUrlSchema = z
  .string()
  .trim()
  .url()
  .startsWith("https://", "Webhook URL must use https://.")
  .max(2048);

const updateSchema = z.object({
  interval: z.string().trim().min(1).max(16).optional(),
  notifyTelegram: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
  notifyWebhookUrl: z.union([webhookUrlSchema, z.literal(""), z.null()]).optional(),
  enabled: z.boolean().optional(),
});

function parseId(idParam: string): number {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid monitor id.");
  return id;
}

/** Update a monitor the user owns — interval, notify channels, enabled state (plan §A6). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const { id: idParam } = await ctx.params;
    const id = parseId(idParam);
    const body = updateSchema.parse(await req.json().catch(() => ({})));
    const monitor = await updateMonitor(userId, id, {
      interval: body.interval,
      notifyTelegram: body.notifyTelegram,
      notifyPush: body.notifyPush,
      notifyWebhookUrl:
        body.notifyWebhookUrl === undefined ? undefined : body.notifyWebhookUrl || null,
      enabled: body.enabled,
    });
    if (!monitor) throw new ApiError(404, "Monitor not found.");
    return NextResponse.json({ monitor });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return handleError(err);
  }
}

/** Delete a monitor the user owns. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const { id: idParam } = await ctx.params;
    const id = parseId(idParam);
    const ok = await deleteMonitor(userId, id);
    if (!ok) throw new ApiError(404, "Monitor not found.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
