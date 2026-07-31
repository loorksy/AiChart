import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { listAlerts } from "@/lib/store";
import type { AlertLog } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A notification stream is long-lived by design. */
export const maxDuration = 300;

const POLL_MS = 5_000;
const HEARTBEAT_MS = 20_000;

/**
 * Server-Sent Events over the operator's alert_log (Group 9).
 *
 * The client connects once and receives every alert written after the id it
 * already has (`Last-Event-ID` header on reconnect, or `?lastId=`). Each event
 * carries the alert row and an SSE `id:` so the browser's automatic reconnect
 * resumes without loss; heartbeat comments keep intermediaries from timing the
 * connection out; the poll timer is torn down on abort so a closed tab never
 * leaves a loop behind.
 *
 * Polling the table (rather than a pub/sub hook) keeps this read-only and safe:
 * it can never miss a writer, because every writer goes through alert_log.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();

    const headerLastId = Number(req.headers.get("last-event-id"));
    const queryLastId = Number(req.nextUrl.searchParams.get("lastId"));
    let lastId =
      Number.isFinite(headerLastId) && headerLastId > 0
        ? headerLastId
        : Number.isFinite(queryLastId) && queryLastId > 0
          ? queryLastId
          : 0;

    // A client with no id yet starts from "now": the initial list belongs to
    // GET /api/alerts; the stream only carries what happens afterwards.
    if (lastId === 0) {
      const latest = await listAlerts(user.id, 1).catch(() => [] as AlertLog[]);
      lastId = latest[0]?.id ?? 0;
    }

    const encoder = new TextEncoder();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let polling = false;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (pollTimer) clearInterval(pollTimer);
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        const write = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup();
          }
        };

        const poll = async () => {
          if (polling || closed) return;
          polling = true;
          try {
            const rows = await listAlerts(user.id, 50);
            const fresh = rows
              .filter((alert) => alert.id > lastId)
              .sort((a, b) => a.id - b.id);
            for (const alert of fresh) {
              lastId = alert.id;
              write(`id: ${alert.id}\nevent: alert\ndata: ${JSON.stringify(alert)}\n\n`);
            }
          } catch {
            /* transient read failure — next tick retries */
          } finally {
            polling = false;
          }
        };

        // Opening comment so proxies flush headers immediately.
        write(`: connected ${Date.now()}\n\n`);
        pollTimer = setInterval(() => void poll(), POLL_MS);
        heartbeatTimer = setInterval(() => write(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);
        void poll();

        req.signal.addEventListener("abort", cleanup);
      },
      cancel() {
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
