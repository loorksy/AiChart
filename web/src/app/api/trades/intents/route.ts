import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { listIntents } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const status = req.nextUrl.searchParams.get("status") || undefined;
    return NextResponse.json({ intents: await listIntents(user.id, status, 40) });
  } catch (err) {
    return handleError(err);
  }
}
