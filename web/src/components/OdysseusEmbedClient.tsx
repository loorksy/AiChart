"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { SmartChartWorkspace } from "@/components/SmartChartWorkspace";
import { ChartErrorBoundary } from "@/components/chart/ChartErrorBoundary";
import {
  sanitizeOdysseusInterval,
  sanitizeOdysseusSource,
  sanitizeOdysseusSymbol,
} from "@/lib/integrations/odysseus";

function postToParent(type: string, data: Record<string, unknown>) {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    { source: "aichart-odysseus-embed", type, ...data },
    "*",
  );
}

export default function OdysseusEmbedClient() {
  const searchParams = useSearchParams();

  const symbol = useMemo(
    () => sanitizeOdysseusSymbol(searchParams.get("symbol")),
    [searchParams],
  );
  const interval = useMemo(
    () => sanitizeOdysseusInterval(searchParams.get("interval")),
    [searchParams],
  );
  const dataSource = useMemo(
    () => sanitizeOdysseusSource(searchParams.get("source")),
    [searchParams],
  );
  const sessionId = searchParams.get("sessionId") ?? undefined;
  const layoutId = searchParams.get("layoutId") ?? undefined;
  const readonlyAgentDrawings =
    searchParams.get("readonlyAgentDrawings") === "1" ||
    searchParams.get("readonly_agent_drawings") === "1";

  useEffect(() => {
    postToParent("ready", { symbol, interval, sessionId: sessionId ?? null });
  }, [symbol, interval, sessionId]);

  const onSymbolChange = useCallback(
    (next: string) => {
      postToParent("symbolChanged", { symbol: next, sessionId: sessionId ?? null });
    },
    [sessionId],
  );

  const onIntervalChange = useCallback(
    (next: string) => {
      postToParent("intervalChanged", { interval: next, sessionId: sessionId ?? null });
    },
    [sessionId],
  );

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <ChartErrorBoundary>
        <SmartChartWorkspace
          guest
          embedMode
          agentReady={false}
          initialSymbol={symbol}
          initialInterval={interval}
          layoutId={layoutId}
          initialState={{ dataSource }}
          odysseusSessionId={sessionId}
          readonlyAgentDrawings={readonlyAgentDrawings}
          onEmbedSymbolChange={onSymbolChange}
          onEmbedIntervalChange={onIntervalChange}
        />
      </ChartErrorBoundary>
    </div>
  );
}
