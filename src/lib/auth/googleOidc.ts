import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { execute, insertReturningId, queryOne } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { assertRegistrationOpen } from "@/lib/auth/registration";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { ensureUserDefaults, getPublicUser } from "@/lib/store";
import type { PublicUser } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth.google");

/**
 * V2-A4 (#93): Google Sign-In as plain OIDC (Authorization Code + PKCE).
 *
 * No auth framework: `jose` (already a dependency) verifies the ID token
 * against Google's JWKS; everything else is two redirects and one token
 * POST. Isolated by design from the MCP-server OAuth in agentAuth.ts —
 * different tables, different cookies, different audience.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const jwks = createRemoteJWKSet(new URL(JWKS_URI));

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export async function googleAuthConfig(): Promise<GoogleOAuthConfig | null> {
  const [enabled, clientId, clientSecret] = await Promise.all([
    getPlatformValueAsync("GOOGLE_AUTH_ENABLED"),
    getPlatformValueAsync("GOOGLE_OAUTH_CLIENT_ID"),
    getPlatformValueAsync("GOOGLE_OAUTH_CLIENT_SECRET"),
  ]);
  if (!(enabled === "1" || enabled === "true")) return null;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** PKCE pair: verifier (kept in an httpOnly cookie) + S256 challenge (sent). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomToken(): string {
  return b64url(randomBytes(24));
}

export function buildGoogleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export async function exchangeCodeForClaims(input: {
  config: GoogleOAuthConfig;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  expectedNonce: string;
}): Promise<GoogleClaims> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }).toString(),
  });
  const data = (await res.json()) as { id_token?: string; error?: string };
  if (!res.ok || !data.id_token) {
    throw new Error(`google token exchange failed: ${data.error ?? res.status}`);
  }
  const { payload } = await jwtVerify(data.id_token, jwks, {
    issuer: ISSUERS,
    audience: input.config.clientId,
  });
  if (payload.nonce !== input.expectedNonce) {
    throw new Error("google id_token nonce mismatch");
  }
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!payload.sub || !email) throw new Error("google id_token missing sub/email");
  return {
    sub: String(payload.sub),
    email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

/**
 * Identity → user resolution, in strict order:
 * 1. known google subject → that linked user;
 * 2. verified email matching an existing account → link and use it;
 * 3. otherwise create a fresh active account (random password — the user can
 *    set one later from their profile).
 * Unverified emails never link to existing accounts (takeover guard) — they
 * only ever create a new isolated account.
 */
export async function resolveGoogleUser(claims: GoogleClaims): Promise<{
  user: PublicUser;
  isNew: boolean;
}> {
  const linked = await queryOne<{ user_id: number }>(
    "SELECT user_id FROM oauth_identities WHERE provider = 'google' AND subject = ?",
    [claims.sub],
  );
  if (linked) {
    const user = await getPublicUser(linked.user_id);
    if (user) return { user, isNew: false };
  }

  const byEmail = await queryOne<{ id: number }>(
    "SELECT id FROM users WHERE email = ?",
    [claims.email],
  );
  if (byEmail) {
    if (!claims.emailVerified) {
      // Takeover guard: an unverified Google email may not claim an existing
      // account — and the email UNIQUE constraint forbids a duplicate one.
      throw new Error("google_email_unverified_conflict");
    }
    await linkIdentity(claims, byEmail.id);
    const user = (await getPublicUser(byEmail.id))!;
    log.info("linked.existing", { userId: byEmail.id });
    return { user, isNew: false };
  }

  // First-time Google account. Existing subjects / verified emails above
  // still sign in when registration is closed; only this insert is gated.
  await assertRegistrationOpen();
  const userId = await insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'user', 'active')",
    [claims.email, hashPassword(randomBytes(32).toString("hex"))],
  );
  await ensureUserDefaults(userId);
  await linkIdentity(claims, userId);
  const user = (await getPublicUser(userId))!;
  log.info("created.new", { userId });
  return { user, isNew: true };
}

async function linkIdentity(claims: GoogleClaims, userId: number): Promise<void> {
  const existing = await queryOne(
    "SELECT user_id FROM oauth_identities WHERE provider = 'google' AND subject = ?",
    [claims.sub],
  );
  if (!existing) {
    await execute(
      "INSERT INTO oauth_identities (provider, subject, user_id, email, created_at) VALUES ('google', ?, ?, ?, ?)",
      [claims.sub, userId, claims.email, Date.now()],
    );
  }
}
