import crypto from "crypto";
import type { NextRequest } from "next/server";
import { ApiError } from "./api";
import { getEaConnectionByTokenHash } from "./eaStore";
import type { EaConnection } from "./types";

const TOKEN_PREFIX = "ea_";

/** Hashes an EA token for storage / lookup (never store the raw token). */
export function hashEaToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

/** Generates a new EA bridge token and its storage hash. */
export function generateEaToken(): { token: string; tokenHash: string } {
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
  return { token, tokenHash: hashEaToken(token) };
}

function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  // Fallback: some MT WebRequest setups send a custom header.
  const alt = req.headers.get("x-ea-token");
  return alt ? alt.trim() : null;
}

/**
 * Authenticates an incoming EA request via its bearer token. Returns the
 * matching connection or throws an ApiError (401/403).
 */
export async function requireEaConnection(
  req: NextRequest,
): Promise<EaConnection> {
  const token = extractBearer(req);
  if (!token) throw new ApiError(401, "EA token is required.");
  const conn = await getEaConnectionByTokenHash(hashEaToken(token));
  if (!conn) throw new ApiError(401, "Invalid EA token.");
  if (conn.status === "revoked") {
    throw new ApiError(403, "EA token has been revoked.");
  }
  return conn;
}
