import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { initDb } from "@/lib/db";
import { setSession } from "@/lib/auth";
import {
  exchangeCodeForClaims,
  googleAuthConfig,
  resolveGoogleUser,
} from "@/lib/auth/googleOidc";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("auth.google.callback");

/** V2-A4 (#93): Google redirects back here; verify everything, sign in. */
export async function GET(req: NextRequest) {
  await initDb();
  const base = await appUrl();
  const fail = (reason: string) => {
    log.warn("rejected", { reason });
    return NextResponse.redirect(new URL(`/login?error=google_${reason}`, base));
  };

  const config = await googleAuthConfig();
  if (!config) return fail("disabled");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const store = await cookies();
  const cookieState = store.get("g_state")?.value;
  const nonce = store.get("g_nonce")?.value;
  const verifier = store.get("g_verifier")?.value;
  for (const name of ["g_state", "g_nonce", "g_verifier"]) store.delete(name);

  if (!code || !state || !cookieState || state !== cookieState) return fail("state");
  if (!nonce || !verifier) return fail("session");

  try {
    const claims = await exchangeCodeForClaims({
      config,
      code,
      codeVerifier: verifier,
      redirectUri: `${base}/api/auth/google/callback`,
      expectedNonce: nonce,
    });
    const { user } = await resolveGoogleUser(claims);
    if (user.status === "suspended") return fail("suspended");
    await setSession({ sub: user.id, email: user.email, role: user.role });
    return NextResponse.redirect(new URL("/chat", base));
  } catch (e) {
    log.error("exchange.failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return fail("exchange");
  }
}

async function appUrl(): Promise<string> {
  return (
    (await getPlatformValueAsync("APP_URL"))?.replace(/\/$/, "") ??
    "https://aichart.lork.cloud"
  );
}
