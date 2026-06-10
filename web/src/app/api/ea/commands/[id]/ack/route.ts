import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError, ApiError } from "@/lib/api";
import { requireEaConnection } from "@/lib/eaAuth";
import { ackEaCommand, getEaCommand } from "@/lib/eaStore";

const schema = z.object({
  status: z.enum(["acked", "failed"]).default("acked"),
  result: z.record(z.string(), z.unknown()).optional(),
});

/** EA confirms command execution (ticket / fill price / error). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const conn = await requireEaConnection(req);
    const { id } = await params;
    const commandId = Number(id);
    if (!Number.isFinite(commandId)) {
      throw new ApiError(400, "Invalid command id.");
    }

    const existing = await getEaCommand(commandId);
    if (!existing || existing.user_id !== conn.user_id) {
      throw new ApiError(404, "Command not found.");
    }

    const { status, result } = schema.parse(await req.json().catch(() => ({})));
    const updated = await ackEaCommand(
      commandId,
      conn.user_id,
      status,
      result ?? {},
    );
    return NextResponse.json({ ok: true, command_id: updated?.id ?? commandId });
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
