import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/api";
import { loadConsoleSettingsProps } from "@/lib/consoleSettingsLoader";

/**
 * The settings surface as a modal needs the same payload the /console/settings
 * page assembles server-side. Same loader, so the modal and the page can never
 * drift into showing different values for the same account.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await loadConsoleSettingsProps(user));
  } catch (error) {
    return handleError(error);
  }
}
