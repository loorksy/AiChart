import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type Database from "better-sqlite3";

export class SqliteClientsStore implements OAuthRegisteredClientsStore {
  constructor(private readonly db: Database.Database) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const row = this.db
      .prepare("SELECT client_json FROM mcp_oauth_clients WHERE client_id = ?")
      .get(clientId) as { client_json: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.client_json) as OAuthClientInformationFull;
  }

  async registerClient(
    clientMetadata: OAuthClientInformationFull,
  ): Promise<OAuthClientInformationFull> {
    this.db
      .prepare(
        `INSERT INTO mcp_oauth_clients (client_id, client_json, created_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(client_id) DO UPDATE SET client_json = excluded.client_json`,
      )
      .run(clientMetadata.client_id, JSON.stringify(clientMetadata));
    return clientMetadata;
  }
}
