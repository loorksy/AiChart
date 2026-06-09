import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { listAlerts, clearAlerts, markAlertsRead } from "@/lib/store";

const patchSchema = z
  .object({
    markAll: z.boolean().optional(),
    ids: z.array(z.number().int().positive()).max(100).optional(),
  })
  .refine((v) => v.markAll || (v.ids && v.ids.length > 0), {
    message: "حدّد markAll أو ids.",
  });

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ alerts: await listAlerts(user.id, 50) });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = patchSchema.parse(await req.json());
    await markAlertsRead(user.id, body.markAll ? undefined : body.ids);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await clearAlerts(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
