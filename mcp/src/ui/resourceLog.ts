import type { ReadResourceCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

export interface ResourceReadLogEntry {
  uri: string;
  matched: boolean;
  mimeType?: string;
  bytes?: number;
  auth: "public" | "session";
  durationMs?: number;
  error?: string;
}

const recentReads: ResourceReadLogEntry[] = [];
const MAX_LOG = 100;

export function logResourceRead(entry: ResourceReadLogEntry): void {
  recentReads.push(entry);
  if (recentReads.length > MAX_LOG) recentReads.shift();
  const parts = [
    "[mcp-ui] resources/read",
    `uri=${entry.uri}`,
    `matched=${entry.matched}`,
    entry.mimeType ? `mime=${entry.mimeType}` : null,
    entry.bytes != null ? `bytes=${entry.bytes}` : null,
    entry.durationMs != null ? `ms=${entry.durationMs}` : null,
    `auth=${entry.auth}`,
    entry.error ? `error=${entry.error}` : null,
  ].filter(Boolean);
  console.log(parts.join(" "));
}

export function getRecentResourceReads(): ResourceReadLogEntry[] {
  return [...recentReads];
}

/** Wrap static HTML read handler: logging, URI alignment, empty-body guard. */
export function loggedHtmlReadHandler(
  registeredUri: string,
  html: string,
  mimeType: string = RESOURCE_MIME_TYPE,
  ui: Record<string, unknown> = { csp: {} },
): ReadResourceCallback {
  return async (uri) => {
    const started = Date.now();
    const requested = uri.href;
    const matched = requested === registeredUri;
    try {
      if (!html || html.length < 32) {
        throw new Error(`empty widget html for ${registeredUri}`);
      }
      if (!matched) {
        logResourceRead({
          uri: requested,
          matched: false,
          mimeType,
          bytes: 0,
          auth: "session",
          durationMs: Date.now() - started,
          error: `uri_mismatch expected=${registeredUri}`,
        });
        throw new Error(`Unknown widget URI: ${requested}`);
      }
      const durationMs = Date.now() - started;
      logResourceRead({
        uri: requested,
        matched: true,
        mimeType,
        bytes: html.length,
        auth: "session",
        durationMs,
      });
      return {
        contents: [
          {
            uri: requested,
            mimeType,
            text: html,
            // Hosts (Claude MCP Apps) build CSP from contents `_meta.ui.csp`,
            // not from the tool. Empty/partial CSP → frame-src 'none'.
            _meta: ui,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logResourceRead({
        uri: requested,
        matched,
        auth: "session",
        durationMs: Date.now() - started,
        error: message,
      });
      throw error;
    }
  };
}
