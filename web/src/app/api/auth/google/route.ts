import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { initDb } from "@/lib/db";
import {
  buildGoogleAuthUrl,
  googleAuthConfig,
  pkcePair,
  randomToken,
} from "@/lib/auth/googleOidc";
import { getPlatformValueAsync } from "@/lib/platformConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 600,
};

/** V2-A4 (#93): kick off Google Sign-In (redirect to Google). */
export async function GET() {
  await initDb();
  const config = await googleAuthConfig();
  if (!config) {
    return NextResponse.redirect(
      new URL("/login?error=google_disabled", await appUrl()),
    );
  }
  const state = randomToken();
  const nonce = randomToken();
  const { verifier, challenge } = pkcePair();
  const redirectUri = `${await appUrl()}/api/auth/google/callback`;

  const store = await cookies();
  store.set("g_state", state, COOKIE_OPTS);
  store.set("g_nonce", nonce, COOKIE_OPTS);
  store.set("g_verifier", verifier, COOKIE_OPTS);

  return NextResponse.redirect(
    buildGoogleAuthUrl({
      clientId: config.clientId,
      redirectUri,
      state,
      nonce,
      codeChallenge: challenge,
    }),
  );
}

async function appUrl(): Promise<string> {
  return (
    (await getPlatformValueAsync("APP_URL"))?.replace(/\/$/, "") ??
    "https://aichart.lork.cloud"
  );
}
