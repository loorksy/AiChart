import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WIDGETS } from "./widgets.js";

/**
 * Every widget is registered TWICE (same HTML, different mimeType):
 * - `ui://aichart/<w>.html`      → text/html;profile=mcp-app  (MCP Apps / Claude)
 * - `ui://aichart/<w>-gpt.html`  → text/html+skybridge        (ChatGPT Apps SDK)
 * because each host dialect expects its own resource profile.
 */
export function appsUri(widget: string): string {
  return `ui://aichart/${widget}.html`;
}

export function skybridgeUri(widget: string): string {
  return `ui://aichart/${widget}-gpt.html`;
}

/** Tool `_meta` that lights the card up on BOTH hosts. */
export function uiMetaFor(widget: string): Record<string, unknown> {
  return {
    ui: { resourceUri: appsUri(widget) },
    "openai/outputTemplate": skybridgeUri(widget),
  };
}

export function registerWidgets(server: McpServer): void {
  for (const [name, html] of Object.entries(WIDGETS)) {
    server.registerResource(
      `widget-${name}`,
      appsUri(name),
      {
        title: `AiChart ${name} card`,
        description: `بطاقة ${name} التفاعلية`,
        mimeType: "text/html;profile=mcp-app",
      },
      async () => ({
        contents: [
          {
            uri: appsUri(name),
            mimeType: "text/html;profile=mcp-app",
            text: html,
          },
        ],
      }),
    );
    server.registerResource(
      `widget-${name}-gpt`,
      skybridgeUri(name),
      {
        title: `AiChart ${name} card (ChatGPT)`,
        description: `بطاقة ${name} التفاعلية لـ ChatGPT`,
        mimeType: "text/html+skybridge",
      },
      async () => ({
        contents: [
          {
            uri: skybridgeUri(name),
            mimeType: "text/html+skybridge",
            text: html,
          },
        ],
      }),
    );
  }
}
