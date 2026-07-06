import { SmartChartWorkspace } from "@/components/SmartChartWorkspace";
import { ChartErrorBoundary } from "@/components/chart/ChartErrorBoundary";
import { isLLMConfiguredAsync } from "@/lib/llm";

export const metadata = {
  title: "AiChart Odysseus Embed",
  description: "Iframe-friendly AiChart trading workspace for Odysseus chat panels.",
};

function cleanSymbol(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const cleaned = (value ?? "EURUSD").toUpperCase().replace(/[^A-Z0-9._:-]/g, "");
  return cleaned || "EURUSD";
}

function cleanInterval(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const allowed = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"]);
  return allowed.has(value ?? "") ? value! : "15m";
}

export default async function OdysseusEmbedPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const symbol = cleanSymbol(params.symbol);
  const interval = cleanInterval(params.interval);

  return (
    <main className="h-dvh min-h-0 overflow-hidden bg-background">
      <ChartErrorBoundary>
        <SmartChartWorkspace
          agentReady={await isLLMConfiguredAsync()}
          guest
          embedMode
          initialSymbol={symbol}
          initialInterval={interval}
        />
      </ChartErrorBoundary>
    </main>
  );
}
