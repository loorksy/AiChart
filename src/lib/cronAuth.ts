import { NextRequest } from "next/server";
import { getPlatformValue } from "./platformConfig";

export function verifyCronSecret(req: NextRequest): boolean {
  const secret = getPlatformValue("CRON_SECRET");
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const header = req.headers.get("x-cron-secret");
  return header === secret;
}
