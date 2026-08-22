"use client";

/**
 * The platform tab's whole behavior: mount the TradingView widget, poll the
 * host-capture RPC, obey capture requests. This runs inside the chart-host
 * container's Playwright page — but nothing here knows or cares about that:
 * it is a normal chart tab, and the pixels come from takeClientScreenshot
 * exactly as they do for an operator.
 *
 * Requests may ship the requesting layout's drawings/studies; they are
 * rendered for that shot and cleared afterwards, so the shared tab always
 * returns to a clean chart between jobs. drawingsRendered is measured off
 * the widget, never assumed from the request.
 */
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { TvChartHandle } from "@/components/chart/TvChart";
import type { ChartStudy } from "@/lib/chart/studies";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { coerceToGold } from "@/lib/gold";
import { normalizeInterval } from "@/lib/intervals";

const TvChart = dynamic(() => import("@/components/chart/TvChart"), {
  ssr: false,
});

const POLL_MS = 500;

interface HostCaptureRequest {
  id: string;
  symbol?: string;
  interval?: string;
  includeDrawings?: boolean;
  includeStudies?: boolean;
  drawings?: ChartDrawing[];
  studies?: ChartStudy[];
  shots?: { label: string; candles: number }[];
}

export function ChartHostAgent({ token }: { token: string }) {
  const chartRef = useRef<TvChartHandle>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [studies, setStudies] = useState<ChartStudy[]>([]);
  const [served, setServed] = useState(0);

  useEffect(() => {
    let stopped = false;
    let busy = false;

    const rpc = (body: Record<string, unknown>) =>
      fetch("/api/chart/host-capture", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

    const processOne = async (request: HostCaptureRequest) => {
      const ack = await rpc({ action: "ack", request_id: request.id });
      if (!ack.ok) return;
      // Render the requesting layout's overlays for THIS shot only.
      const wantsOverlays = Boolean(request.drawings?.length || request.studies?.length);
      if (wantsOverlays) {
        setDrawings(request.drawings ?? []);
        setStudies(request.studies ?? []);
        // One frame for the drawing adapter to apply the shapes.
        await new Promise((r) => window.setTimeout(r, 400));
      }
      try {
        const shot = await chartRef.current?.captureSnapshot({
          includeDrawings: request.includeDrawings !== false,
          includeStudies: request.includeStudies !== false,
          symbol: request.symbol,
          interval: request.interval,
          shots: request.shots,
        });
        if (!shot) return;
        await rpc({
          action: "upload",
          request_id: request.id,
          images: shot.images.map((image) => ({
            label: image.label,
            image_base64: image.pngBase64,
          })),
          drawings_rendered: shot.drawingsRendered,
          studies_rendered: shot.studiesRendered,
        });
        setServed((n) => n + 1);
      } finally {
        if (wantsOverlays) {
          setDrawings([]);
          setStudies([]);
        }
      }
    };

    const tick = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        const res = await fetch(
          `/api/chart/host-capture?token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { requests?: HostCaptureRequest[] };
        for (const request of data.requests ?? []) {
          if (stopped) break;
          await processOne(request);
        }
      } catch {
        /* transient — next tick */
      } finally {
        busy = false;
      }
    };

    const t = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [token]);

  return (
    <div style={{ height: "100svh", width: "100%", background: "#0f1115" }}>
      <TvChart
        ref={chartRef}
        symbol={coerceToGold()}
        interval={normalizeInterval("15m")}
        theme="dark"
        locale="ar"
        direction="rtl"
        capture
        drawings={drawings}
        studies={studies}
        className="h-full w-full"
      />
      {/* Machine-readable heartbeat for the container's health probe. */}
      <div
        id="chart-host-status"
        data-served={served}
        style={{ position: "fixed", insetInlineStart: 8, bottom: 8, fontSize: 10, color: "#475569", fontFamily: "monospace" }}
      >
        lonora chart host · served {served}
      </div>
    </div>
  );
}
