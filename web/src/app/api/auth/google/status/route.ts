import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { googleAuthConfig } from "@/lib/auth/googleOidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** V2-A4 (#93): tells the login/signup pages whether to show the button. */
export async function GET() {
  await initDb();
  return NextResponse.json({ enabled: (await googleAuthConfig()) != null });
}
