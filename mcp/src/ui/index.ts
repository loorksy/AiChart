import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createUIResource } from "@mcp-ui/server";
import { WIDGETS } from "./widgets.js";

const VERSIONED_WIDGET_PATHS: Record<string, string> = {
  "account-overview": "account-overview/v1",
  analysis: "analysis/v1",
};

function asUiUri(path: string): `ui://${string}` {
  return `ui://${path}` as `ui://${string}`;
}

function widgetPath(widget: string): string {
  return VERSIONED_WIDGET_PATHS[widget] ?? `${widget}.html`;
}

function skybridgePath(widget: string): string {
  return VERSIONED_WIDGET_PATHS[widget]
    ? `${VERSIONED_WIDGET_PATHS[widget]}-gpt`
    : `${widget}-gpt.html`;
}

export function appsUri(widget: string): string {
  return `ui://aichart/${widgetPath(widget)}`;
}

export function skybridgeUri(widget: string): string {
  return `ui://aichart/${skybridgePath(widget)}`;
}

export function uiMetaFor(widget: string): Record<string, unknown> {
  return {
    ui: { resourceUri: appsUri(widget) },
    "openai/outputTemplate": skybridgeUri(widget),
    "openai/toolInvocation/invoking": "تشغيل Lonora...",
    "openai/toolInvocation/invoked": "اكتمل تحديث Lonora.",
    "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
  };
}

export function registerWidgets(server: McpServer): void {
  for (const [name, html] of Object.entries(WIDGETS)) {
    const nativeUri = appsUri(name);
    const gptUri = skybridgeUri(name);
    const gptResource = createUIResource({
      uri: asUiUri(skybridgePath(name)),
      content: { type: "rawHtml", htmlString: html },
      encoding: "text",
      adapters: { appsSdk: { enabled: true } },
    }).resource;

    server.registerResource(
      `widget-${name}`,
      nativeUri,
      {
        title: `Lonora ${name} card`,
        description: `بطاقة Lonora التفاعلية: ${name}`,
        mimeType: "text/html;profile=mcp-app",
      },
      async () => ({
        contents: [
          {
            uri: nativeUri,
            mimeType: "text/html;profile=mcp-app",
            text: html,
          },
        ],
      }),
    );

    server.registerResource(
      `widget-${name}-gpt`,
      gptUri,
      {
        title: `Lonora ${name} card (ChatGPT)`,
        description: `بطاقة Lonora التفاعلية لواجهة ChatGPT: ${name}`,
        mimeType: gptResource.mimeType,
      },
      async () => ({
        contents: [
          {
            uri: gptUri,
            mimeType: gptResource.mimeType,
            text: gptResource.text ?? html,
          },
        ],
      }),
    );
  }
}
