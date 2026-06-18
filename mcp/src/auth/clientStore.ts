import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { mcpPgQuery, mcpPgQueryOne, mcpPgExecute } from "./db.js";

export class PgClientsStore implements OAuthRegisteredClientsStore {
  async getClient(
    clientId: string,
  ): Promise<OAuthClientInformationFull | undefined> {
    const row = await mcpPgQueryOne<{ client_json: string }>(
      "SELECT client_json FROM mcp_oauth_clients WHERE client_id = $1",
      [clientId],
    );
    if (!row) return undefined;
    return JSON.parse(row.client_json) as OAuthClientInformationFull;
  }

  async registerClient(
    clientMetadata: OAuthClientInformationFull,
  ): Promise<OAuthClientInformationFull> {
    await mcpPgExecute(
      `INSERT INTO mcp_oauth_clients (client_id, client_json, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (client_id) DO UPDATE SET client_json = EXCLUDED.client_json`,
      [clientMetadata.client_id, JSON.stringify(clientMetadata)],
    );
    return clientMetadata;
  }
}

/** @deprecated alias for backward compat — use PgClientsStore */
export const SqliteClientsStore = PgClientsStore;
