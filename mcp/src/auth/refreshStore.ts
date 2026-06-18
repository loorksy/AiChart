import { randomUUID } from "node:crypto";
import { hashRefreshToken } from "./jwt.js";
import { mcpPgQueryOne, mcpPgExecute } from "./db.js";

export interface RefreshRecord {
  clientId: string;
  email: string;
  scopes: string[];
  expiresAt: string;
}

export class RefreshTokenStore {
  constructor(
    private readonly ttlDays: number,
  ) {}

  async issue(
    clientId: string,
    email: string,
    scopes: string[],
  ): Promise<{ raw: string; expiresAt: string }> {
    const raw = randomUUID();
    const tokenHash = hashRefreshToken(raw);
    const expiresAt = new Date(
      Date.now() + this.ttlDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    await mcpPgExecute(
      `INSERT INTO mcp_oauth_refresh_tokens
        (token_hash, client_id, email, scopes_json, expires_at, revoked, created_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, NOW())
       ON CONFLICT (token_hash) DO NOTHING`,
      [tokenHash, clientId, email, JSON.stringify(scopes), expiresAt],
    );

    return { raw, expiresAt };
  }

  async consume(raw: string): Promise<RefreshRecord | null> {
    const tokenHash = hashRefreshToken(raw);

    const row = await mcpPgQueryOne<{
      client_id: string;
      email: string;
      scopes_json: string;
      expires_at: string;
      revoked: boolean;
    }>(
      `SELECT client_id, email, scopes_json, expires_at, revoked
       FROM mcp_oauth_refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );

    if (!row || row.revoked) return null;
    if (Date.parse(row.expires_at) < Date.now()) return null;

    // Mark as revoked (one-time use)
    await mcpPgExecute(
      "UPDATE mcp_oauth_refresh_tokens SET revoked = TRUE WHERE token_hash = $1",
      [tokenHash],
    );

    return {
      clientId: row.client_id,
      email: row.email,
      scopes: JSON.parse(row.scopes_json) as string[],
      expiresAt: row.expires_at,
    };
  }
}
