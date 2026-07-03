import type { ReadResourceCallback } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ResourceReadLogEntry {
  uri: string;
  matched: boolean;
  mimeType?: string;
  bytes?: number;
  auth: "public" | "session";
  error?: string;
}

const recentReads: ResourceReadLogEntry[] = [];
const MAX_LOG = 50;

export function logResourceRead(entry: ResourceReadLogEntry): void {
  recentReads.push(entry);
  if (recentReads.length > MAX_LOG) recentReads.shift();
  const parts = [
    "[mcp-ui] resources/read",
    `uri=${entry.uri}`,
    `matched=${entry.matched}`,
    entry.mimeType ? `mime=${entry.mimeType}` : null,
    entry.bytes != null ? `bytes=${entry.bytes}` : null,
    `auth=${entry.auth}`,
    entry.error ? `error=${entry.error}` : null,
  ].filter(Boolean);
  console.log(parts.join(" "));
}

export function getRecentResourceReads(): ResourceReadLogEntry[] {
  return [...recentReads];
}

/** Wrap a static HTML read handler with logging and request-uri alignment. */
export function loggedHtmlReadHandler(
  registeredUri: string,
  html: string,
  mimeType: string,
): ReadResourceCallback {
  return async (uri) => {
    const requested = uri.href;
    const matched = requested === registeredUri;
    try {
      logResourceRead({
        uri: requested,
        matched,
        mimeType,
        bytes: html.length,
        auth: "session",
      });
      return {
        contents: [
          {
            uri: requested,
            mimeType,
            text: html,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logResourceRead({
        uri: requested,
        matched,
        auth: "session",
        error: message,
      });
      throw error;
    }
  };
}
