import { NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { deleteBinanceAccount } from "@/lib/store";

export async function DELETE() {
  try {
    const user = await requireUser();
    deleteBinanceAccount(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
