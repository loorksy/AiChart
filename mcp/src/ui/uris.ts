/** Shared widget URI constants — tool _meta and registerAppResource must use these only. */

export const UI_HOST = "aichart";

/** Versioned flagship MCP App templates (bump path when markup changes).
 *  v5: locale-aware cards (EN/AR via runtime i18n, 2026-07-05). */
export const APP_URI_ACCOUNT_OVERVIEW = `ui://${UI_HOST}/account-overview/v5` as const;
export const APP_URI_ANALYSIS = `ui://${UI_HOST}/analysis/v5` as const;

const VERSIONED_WIDGET_PATHS: Record<string, string> = {
  "account-overview": "account-overview/v5",
  analysis: "analysis/v5",
  portfolio: "portfolio/v3",
  "live-chart": "live-chart/v11",
  "chart-drawn": "chart-drawn/v11",
  "recommendation-card": "recommendation-card/v6",
};

/** Older URIs Claude may still request after a version bump — serve current HTML. */
export function legacyWidgetUris(widget: string): string[] {
  const current = widgetPath(widget);
  const m = current.match(/^(.+)\/v(\d+)$/);
  if (!m) return [];
  const base = m[1];
  const ver = Number(m[2]);
  const out: string[] = [];
  for (let v = 1; v < ver; v++) {
    out.push(`ui://${UI_HOST}/${base}/v${v}`);
    out.push(`ui://${UI_HOST}/${base}/v${v}-gpt`);
  }
  return out;
}

export function widgetPath(widget: string): string {
  // Hosts (Claude MCP Apps) cache widget HTML by URI — bump version on every
  // visual/markup change or clients keep serving stale templates forever.
  return VERSIONED_WIDGET_PATHS[widget] ?? `${widget}/v5`;
}

export function widgetUri(widget: string): string {
  return `ui://${UI_HOST}/${widgetPath(widget)}`;
}

export function skybridgePath(widget: string): string {
  return `${widgetPath(widget)}-gpt`;
}

export function skybridgeUri(widget: string): string {
  return `ui://${UI_HOST}/${skybridgePath(widget)}`;
}
