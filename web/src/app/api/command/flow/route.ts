import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";

/** Legacy flow endpoint — returns empty payload on forex-only platform. */
export async function GET() {
  try {
    await requirePlatformAccess();
    return NextResponse.json({ flows: [], rank: null });
  } catch (err) {
    return handleError(err);
  }
}
