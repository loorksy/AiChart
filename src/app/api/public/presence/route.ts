import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { checkRateLimit, clientKey } from "@/lib/api";
import {
  isBotUserAgent,
  newVisitorId,
  normalizePublicPath,
  parseVisitorId,
  recordHeartbeat,
  VISITOR_COOKIE,
  visitorCookieOptions,
} from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function softOk(ok: boolean, vid?: string, setCookie?: boolean): NextResponse {
  const res = NextResponse.json({ ok });
  if (setCookie && vid) {
    res.cookies.set(VISITOR_COOKIE, vid, visitorCookieOptions());
  }
  return res;
}

/**
 * Public heartbeat. Creates `lonora_vid` on first visit. Fail-soft: Redis
 * or a bad body never 500s the landing.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    if (isBotUserAgent(req.headers.get("user-agent"))) {
      return softOk(false);
    }
    if (!checkRateLimit(`presence:${clientKey(req)}`, 20, 60_000)) {
      return softOk(false);
    }

    let pathRaw: unknown;
    try {
      const body = (await req.json()) as { path?: unknown };
      pathRaw = body?.path;
    } catch {
      return softOk(false);
    }

    const path = normalizePublicPath(pathRaw);
    if (!path) return softOk(false);

    const jar = await cookies();
    const existing = parseVisitorId(jar.get(VISITOR_COOKIE)?.value);
    const vid = existing ?? newVisitorId();
    const wrote = await recordHeartbeat(vid, path);
    return softOk(wrote, vid, !existing);
  } catch {
    return softOk(false);
  }
}
