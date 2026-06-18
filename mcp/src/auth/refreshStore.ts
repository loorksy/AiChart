import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { hashRefreshToken } from "./jwt.js";

export interface RefreshRecord {
  clientId: string;
  email: string;
  scopes: string[];
  expiresAt: string;
}

export class RefreshTokenStore {
  constructor(
    private readonly db: Database.Database,
    private readonly ttlDays: number,
  ) {}

  issue(
    clientId: string,
    email: string,
    scopes: string[],
  ): { raw: string; expiresAt: string } {
    const raw = randomUUID();
    const tokenHash = hashRefreshToken(raw);
    const expiresAt = new Date(
      Date.now() + this.ttlDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.db
      .prepare(
        `INSERT INTO mcp_oauth_refresh_tokens
          (token_hash, client_id, email, scopes_json, expires_at, revoked, created_at)
         VALUES (?, ?, ?, ?, ?, 0, datetime('now'))`,
      )
      .run(tokenHash, clientId, email, JSON.stringify(scopes), expiresAt);
    return { raw, expiresAt };
  }

  consume(raw: string): RefreshRecord | null {
    const tokenHash = hashRefreshToken(raw);
    const row = this.db
      .prepare(
        `SELECT client_id, email, scopes_json, expires_at, revoked
         FROM mcp_oauth_refresh_tokens WHERE token_hash = ?`,
      )
      .get(tokenHash) as
      | {
          client_id: string;
          email: string;
          scopes_json: string;
          expires_at: string;
          revoked: number;
        }
      | undefined;
    if (!row || row.revoked) return null;
    if (Date.parse(row.expires_at) < Date.now()) return null;
    this.db
      .prepare(
        "UPDATE mcp_oauth_refresh_tokens SET revoked = 1 WHERE token_hash = ?",
      )
      .run(tokenHash);
    return {
      clientId: row.client_id,
      email: row.email,
      scopes: JSON.parse(row.scopes_json) as string[],
      expiresAt: row.expires_at,
    };
  }
}
