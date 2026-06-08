import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { updateSettings, getSettings } from "@/lib/store";

const schema = z.object({ on: z.boolean() });

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { on } = schema.parse(await req.json());
    updateSettings(user.id, { kill_switch: on ? 1 : 0 });
    return NextResponse.json({ kill_switch: getSettings(user.id).kill_switch });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "قيمة غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
