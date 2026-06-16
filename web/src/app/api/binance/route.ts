import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { deleteBinanceAccount } from "@/lib/store";

export async function DELETE() {
  try {
    const user = await requirePlatformAccess();
    await deleteBinanceAccount(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
