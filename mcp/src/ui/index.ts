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
import { legacyWidgetUris, skybridgePath, skybridgeUri, widgetUri } from "./uris.js";
import { WIDGETS } from "./widgets.js";

const PANE_WIDGETS = new Set(["live-chart", "chart-drawn"]);

export type ResourceCsp = {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
};

/** MCP Apps resource `_meta.ui` — inline cards need no nested-iframe CSP. */
export function resourceUiFor(widget: string): {
  csp: ResourceCsp;
  prefersBorder?: boolean;
} {
  if (PANE_WIDGETS.has(widget)) {
    return { csp: {}, prefersBorder: false };
  }
  return { csp: {} };
}

/** `resources/read` contents `_meta` — hosts take CSP from here, not tool `_meta`. */
export function resourceContentsMeta(widget: string): Record<string, unknown> {
  return { ui: resourceUiFor(widget) };
}

function registerWidgetResource(
  server: McpServer,
  label: string,
  uri: string,
  html: string,
  mimeType: string,
  widget: string,
): void {
  const contentsMeta = resourceContentsMeta(widget);
  registerAppResource(
    server,
    label,
    uri,
    {
      description: label,
      ...(mimeType !== RESOURCE_MIME_TYPE ? { mimeType } : {}),
      _meta: contentsMeta,
    },
    loggedHtmlReadHandler(uri, html, mimeType, contentsMeta),
  );
}

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
    ui: { resourceUri, ...resourceUiFor(widget) },
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
    const gptHtml = gptResource.text ?? html;
    const gptMime = gptResource.mimeType;

    registerWidgetResource(server, `Lonora ${name} card`, nativeUri, html, RESOURCE_MIME_TYPE, name);
    registerWidgetResource(server, `Lonora ${name} card (ChatGPT)`, gptUri, gptHtml, gptMime, name);

    for (const legacyUri of legacyWidgetUris(name)) {
      const isGpt = legacyUri.endsWith("-gpt");
      registerWidgetResource(
        server,
        `Lonora ${name} card (legacy)`,
        legacyUri,
        isGpt ? gptHtml : html,
        isGpt ? gptMime : RESOURCE_MIME_TYPE,
        name,
      );
    }
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
    const legacyPaths = legacyWidgetUris(name).map((u) =>
      u.replace(/^ui:\/\/aichart\//, ""),
    );
    const isGptPath = normalized === gpt || legacyPaths.includes(normalized) && normalized.endsWith("-gpt");
    const isNativePath =
      normalized === native ||
      (legacyPaths.includes(normalized) && !normalized.endsWith("-gpt"));
    if (!isNativePath && !isGptPath) continue;

    if (isGptPath) {
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
    return { uri: widgetUri(name), html, mimeType: RESOURCE_MIME_TYPE };
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
