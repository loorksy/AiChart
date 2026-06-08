import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import { setFlag, isMasterKillOn } from "@/lib/store";

const schema = z.object({ on: z.boolean() });

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ master_kill: await isMasterKillOn() });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { on } = schema.parse(await req.json());
    await setFlag("master_kill", on ? "1" : "0");
    return NextResponse.json({ master_kill: await isMasterKillOn() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "قيمة غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
