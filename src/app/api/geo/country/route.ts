import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { detectCountryFromRequest } from "@/lib/geoCountry";

export async function GET(req: NextRequest) {
  const h = await headers();
  const clientTz = req.headers.get("x-timezone") ?? req.headers.get("X-Timezone");
  const country = detectCountryFromRequest(h, clientTz);
  return NextResponse.json({ country });
}
