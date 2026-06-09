import { NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { listAlerts, clearAlerts } from "@/lib/store";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ alerts: await listAlerts(user.id, 50) });
  } catch (err) {
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
