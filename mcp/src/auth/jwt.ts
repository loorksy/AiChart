import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export interface AccessTokenClaims {
  email: string;
  clientId: string;
  scopes: string[];
  resource?: string;
}

function secretKey(authSecret: string): Uint8Array {
  return createHash("sha256").update(authSecret).digest();
}

export async function mintAccessToken(
  authSecret: string,
  claims: AccessTokenClaims,
  ttlDays: number,
): Promise<{ token: string; expiresAtSec: number }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAtSec = nowSec + ttlDays * 24 * 60 * 60;
  const token = await new SignJWT({
    client_id: claims.clientId,
    scope: claims.scopes.join(" "),
    ...(claims.resource ? { resource: claims.resource } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.email)
    .setIssuedAt(nowSec)
    .setExpirationTime(expiresAtSec)
    .sign(secretKey(authSecret));
  return { token, expiresAtSec };
}

export async function verifyAccessTokenJwt(
  authSecret: string,
  token: string,
): Promise<AuthInfo> {
  const { payload } = await jwtVerify(token, secretKey(authSecret), {
    algorithms: ["HS256"],
  });
  const email = typeof payload.sub === "string" ? payload.sub : "";
  const clientId =
    typeof payload.client_id === "string" ? payload.client_id : "";
  const scopeStr = typeof payload.scope === "string" ? payload.scope : "";
  const scopes = scopeStr ? scopeStr.split(/\s+/).filter(Boolean) : ["mcp:tools"];
  const resourceRaw =
    typeof payload.resource === "string" ? payload.resource : undefined;
  if (!email || !clientId) {
    throw new Error("Invalid or expired token");
  }
  return {
    token,
    clientId,
    scopes,
    expiresAt: typeof payload.exp === "number" ? payload.exp : 0,
    resource: resourceRaw ? new URL(resourceRaw) : undefined,
    extra: { email },
  };
}

export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
