/** Shared widget URI constants — tool _meta and registerAppResource must use these only. */

export const UI_HOST = "aichart";

/** Versioned flagship MCP App templates (bump path when markup changes).
 *  v2: assets inlined (Claude sandbox blocks external CSS/JS) + premium theme. */
export const APP_URI_ACCOUNT_OVERVIEW = `ui://${UI_HOST}/account-overview/v2` as const;
export const APP_URI_ANALYSIS = `ui://${UI_HOST}/analysis/v2` as const;

const VERSIONED_WIDGET_PATHS: Record<string, string> = {
  "account-overview": "account-overview/v2",
  analysis: "analysis/v2",
  portfolio: "portfolio/v1",
};

export function widgetPath(widget: string): string {
  return VERSIONED_WIDGET_PATHS[widget] ?? `${widget}.html`;
}

export function widgetUri(widget: string): string {
  return `ui://${UI_HOST}/${widgetPath(widget)}`;
}

export function skybridgePath(widget: string): string {
  return VERSIONED_WIDGET_PATHS[widget]
    ? `${VERSIONED_WIDGET_PATHS[widget]}-gpt`
    : `${widget}-gpt.html`;
}

export function skybridgeUri(widget: string): string {
  return `ui://${UI_HOST}/${skybridgePath(widget)}`;
}
