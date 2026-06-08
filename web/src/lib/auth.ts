import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { getAppSecret } from "./env";
import { getDb } from "./db";
import type { PublicUser, SessionPayload, UserRow } from "./types";

const SESSION_COOKIE = "aichart_session";
const SESSION_TTL = "7d";

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getAppSecret());
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export async function createSessionToken(
  payload: SessionPayload,
): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.sub))
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secretKey());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return {
      sub: Number(payload.sub),
      email: String(payload.email),
      role: payload.role === "admin" ? "admin" : "user",
    };
  } catch {
    return null;
  }
}

/** Sets session cookie; returns JWT for API clients (Bearer header). */
export async function setSession(payload: SessionPayload): Promise<string> {
  const token = await createSessionToken(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return token;
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

async function sessionTokenFromRequest(): Promise<string | null> {
  const store = await cookies();
  const cookieToken = store.get(SESSION_COOKIE)?.value;
  if (cookieToken) return cookieToken;
  const h = await headers();
  const auth = h.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim() || null;
  return null;
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = await sessionTokenFromRequest();
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;

  const row = getDb()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(session.sub) as UserRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
  };
}

export { SESSION_COOKIE };
