import { getPublicAppUrl } from "./appUrl";

function normalizeToken(value: string): string {
  return value.trim().replace(/\r$/, "");
}

function bridgeServiceToken(): string | null {
  const raw = process.env.AICHART_SERVICE_TOKEN;
  if (!raw) return null;
  const token = normalizeToken(raw);
  return token.length >= 16 ? token : null;
}

/** Absolute public URL for agent chart/media endpoints (Telegram-safe). */
export function publicAgentChartUrl(
  path: string,
  options: { withToken?: boolean } = {},
): string | null {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getPublicAppUrl();
  if (!options.withToken) return `${base}${normalized}`;
  const token = bridgeServiceToken();
  if (!token) return null;
  const sep = normalized.includes("?") ? "&" : "?";
  return `${base}${normalized}${sep}token=${encodeURIComponent(token)}`;
}

export function chartCaptureUrls(captureKey: string): {
  chart_url: string;
  chart_url_public: string;
  chart_url_telegram: string | null;
} {
  const chart_url = `/api/agent/chart/capture/${captureKey}`;
  return {
    chart_url,
    chart_url_public: publicAgentChartUrl(chart_url) ?? chart_url,
    chart_url_telegram: publicAgentChartUrl(chart_url, { withToken: true }),
  };
}

export function agentChartUrls(relativePath: string): {
  chart_url: string;
  chart_url_public: string;
  chart_url_telegram: string | null;
} {
  const chart_url = relativePath.startsWith("/")
    ? relativePath
    : `/${relativePath}`;
  return {
    chart_url,
    chart_url_public: publicAgentChartUrl(chart_url) ?? chart_url,
    chart_url_telegram: publicAgentChartUrl(chart_url, { withToken: true }),
  };
}
