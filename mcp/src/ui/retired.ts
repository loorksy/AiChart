import { UI_HOST } from "./uris.js";

/** Widgets Claude may still request from cached tool `_meta` after they were
 *  removed from `WIDGETS`. Serving a blank shell at these URIs prevents
 *  "Failed to fetch app content" without resurrecting the old cards. */
export const RETIRED_WIDGETS: ReadonlyArray<{ name: string; version: number }> = [
  { name: "lessons-card", version: 5 },
  { name: "jobs-report", version: 5 },
  { name: "analysis", version: 5 },
  { name: "scan-results", version: 5 },
  { name: "levels-report", version: 5 },
  { name: "levels-card", version: 5 },
  { name: "pair-picker", version: 5 },
  { name: "risk-status", version: 5 },
  { name: "market-snapshot", version: 5 },
  { name: "mtf-analysis", version: 5 },
  { name: "account-overview", version: 5 },
  { name: "account-status", version: 5 },
  { name: "open-trades", version: 5 },
  { name: "trade-readiness", version: 5 },
  { name: "approval-card", version: 5 },
  { name: "approval-queue", version: 5 },
  { name: "pending-approvals", version: 5 },
  { name: "portfolio", version: 3 },
];

/** Transparent zero-height shell — fetch succeeds, nothing paints. */
export const RETIRED_STUB_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>Lonora</title>
<style>html,body{margin:0;padding:0;background:transparent!important;height:0;min-height:0;overflow:hidden}</style>
</head>
<body></body>
</html>
`;

export function retiredWidgetUris(): string[] {
  const out: string[] = [];
  for (const { name, version } of RETIRED_WIDGETS) {
    for (let v = 1; v <= version; v++) {
      out.push(`ui://${UI_HOST}/${name}/v${v}`);
      out.push(`ui://${UI_HOST}/${name}/v${v}-gpt`);
    }
  }
  return out;
}

export function matchRetiredWidgetPath(path: string): {
  uri: string;
  gpt: boolean;
} | null {
  const isGpt = path.endsWith("-gpt");
  const base = isGpt ? path.slice(0, -4) : path;
  const m = /^([a-z0-9-]+)\/v(\d+)$/.exec(base);
  if (!m) return null;
  const spec = RETIRED_WIDGETS.find((w) => w.name === m[1]);
  if (!spec) return null;
  const ver = Number(m[2]);
  if (!Number.isFinite(ver) || ver < 1 || ver > spec.version) return null;
  return { uri: `ui://${UI_HOST}/${base}${isGpt ? "-gpt" : ""}`, gpt: isGpt };
}
