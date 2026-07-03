import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "@modelcontextprotocol/ext-apps/server";
import { createUIResource } from "@mcp-ui/server";
import { loggedHtmlReadHandler, logResourceRead } from "./resourceLog.js";
import { normalizeWidgetPublicPath } from "./publicPath.js";
import { publicAssetOrigin } from "./runtime.js";
import { skybridgePath, skybridgeUri, widgetUri } from "./uris.js";
import { WIDGETS } from "./widgets.js";

function asUiUri(path: string): `ui://${string}` {
  return `ui://${path}` as `ui://${string}`;
}

export {
  APP_URI_ACCOUNT_OVERVIEW,
  APP_URI_ANALYSIS,
  widgetUri,
  skybridgeUri,
} from "./uris.js";
export { getRecentResourceReads, logResourceRead } from "./resourceLog.js";

export function appsUri(widget: string): string {
  return widgetUri(widget);
}

/** Tool `_meta` for MCP Apps + ChatGPT (modern + legacy UI URI keys). */
export function uiMetaFor(widget: string): Record<string, unknown> {
  const resourceUri = widgetUri(widget);
  const origin = publicAssetOrigin();
  return {
    ui: { resourceUri },
    [RESOURCE_URI_META_KEY]: resourceUri,
    "openai/outputTemplate": skybridgeUri(widget),
    "openai/toolInvocation/invoking": "تشغيل Lonora...",
    "openai/toolInvocation/invoked": "اكتمل تحديث Lonora.",
    "openai/widgetCSP": {
      connect_domains: [origin],
      resource_domains: [origin],
    },
  };
}

export function registerWidgets(server: McpServer): void {
  for (const [name, html] of Object.entries(WIDGETS)) {
    const nativeUri = widgetUri(name);
    const gptUri = skybridgeUri(name);
    const gptResource = createUIResource({
      uri: asUiUri(skybridgePath(name)),
      content: { type: "rawHtml", htmlString: html },
      encoding: "text",
      adapters: { appsSdk: { enabled: true } },
    }).resource;

    registerAppResource(
      server,
      `Lonora ${name} card`,
      nativeUri,
      {
        description: `بطاقة Lonora التفاعلية: ${name}`,
      },
      loggedHtmlReadHandler(nativeUri, html, RESOURCE_MIME_TYPE),
    );

    registerAppResource(
      server,
      `Lonora ${name} card (ChatGPT)`,
      gptUri,
      {
        description: `بطاقة Lonora التفاعلية لواجهة ChatGPT: ${name}`,
        mimeType: gptResource.mimeType,
      },
      loggedHtmlReadHandler(gptUri, gptResource.text ?? html, gptResource.mimeType),
    );
  }
}

/** Public template lookup for unauthenticated HTTP fallback (static markup only). */
export function widgetHtmlByPublicPath(path: string): {
  uri: string;
  html: string;
  mimeType: string;
} | null {
  const normalized = normalizeWidgetPublicPath(path);
  for (const [name, html] of Object.entries(WIDGETS)) {
    const native = widgetUri(name).replace(/^ui:\/\/aichart\//, "");
    const gpt = skybridgeUri(name).replace(/^ui:\/\/aichart\//, "");
    if (normalized === native) {
      return { uri: widgetUri(name), html, mimeType: RESOURCE_MIME_TYPE };
    }
    if (normalized === gpt) {
      const gptResource = createUIResource({
        uri: asUiUri(skybridgePath(name)),
        content: { type: "rawHtml", htmlString: html },
        encoding: "text",
        adapters: { appsSdk: { enabled: true } },
      }).resource;
      return {
        uri: skybridgeUri(name),
        html: gptResource.text ?? html,
        mimeType: gptResource.mimeType,
      };
    }
  }
  return null;
}

export function logPublicWidgetFetch(path: string, hit: boolean, bytes?: number): void {
  logResourceRead({
    uri: path,
    matched: hit,
    mimeType: hit ? RESOURCE_MIME_TYPE : undefined,
    bytes,
    auth: "public",
    error: hit ? undefined : "not_found",
  });
}
