import { NextResponse } from "next/server";
import { buildOdysseusIntegrationManifest } from "@/lib/integrations/odysseus";

/** Public bootstrap manifest consumed by an Odysseus chat workspace. */
export async function GET() {
  return NextResponse.json(buildOdysseusIntegrationManifest());
}
