import type { Metadata } from "next";
import { ChartHostAgent } from "@/components/chart/ChartHostAgent";
import { verifyChartHostToken } from "@/lib/chart/hostToken";

export const metadata: Metadata = {
  title: "Lonora chart host",
  robots: { index: false, follow: false },
};

function pick(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The PLATFORM's own chart tab — the one page the chart-host container is
 * allowed to open. It mounts the same TradingView widget an operator sees and
 * answers capture RPCs by calling takeClientScreenshot, exactly like an
 * operator tab. There is nothing else on it and nothing interactive about it.
 *
 * Access is the chart-host HMAC token only. Without a valid token the page
 * renders a refusal and mounts no widget at all.
 */
export default async function ChartHostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = pick(params, "token") ?? null;
  const claims = verifyChartHostToken(token);
  if (!claims || !token) {
    return (
      <div style={{ padding: 24, fontFamily: "monospace", fontSize: 13 }}>
        chart-host: invalid or missing token
      </div>
    );
  }
  return <ChartHostAgent token={token} />;
}
