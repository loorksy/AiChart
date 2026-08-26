import { NextRequest } from "next/server";
import {
  checkRateLimit,
  clientKey,
  getOptionalUser,
  handleError,
} from "@/lib/api";
import { t } from "@/lib/i18n";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import { subscribeOandaSymbolTicks } from "@/lib/markets/oandaStream";
import { TRADABLE_SYMBOLS } from "@/lib/markets/forexInstruments";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRADABLE_SET = new Set(TRADABLE_SYMBOLS.map((s) => forexCanonicalKey(s)));

/** Server heartbeat cadence. The client's silence watchdog (SSE_SILENT_MS in
 *  tvDatafeed) must tolerate at least two missed beats before declaring the
 *  socket dead. Not exported — Next.js route modules allow only route fields. */
const TICKS_HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events of live bid/ask from the platform's shared OANDA
 * stream. No per-user account or link is required — guests (MCP embed, public
 * chart) and signed-in operators share the same feed. Guest connects are
 * rate-limited. Closing the EventSource tears the listener down.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getOptionalUser();
    if (!user && !checkRateLimit(`ticks:${clientKey(req)}`, 30, 60_000)) {
      return new Response(
        JSON.stringify({ error: t("ar", "api.guest_rate_limit") }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }
    const symbol = (req.nextUrl.searchParams.get("symbol") ?? "")
      .trim()
      .replace(/[^A-Za-z0-9._]/g, "");
    if (!symbol) {
      return new Response(JSON.stringify({ error: "symbol required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!TRADABLE_SET.has(forexCanonicalKey(symbol))) {
      return new Response(null, { status: 204 });
    }

    const decision = await resolveMarketDataSource();
    if (!decision.available.oanda) {
      return new Response(null, { status: 204 });
    }

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let closed = false;

    const stream = new ReadableStream({
      start(controller) {
        const send = (payload: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
            );
          } catch {
            closed = true;
          }
        };

        send({ type: "ready", symbol, source: "oanda" });

        try {
          unsubscribe = subscribeOandaSymbolTicks({
            symbol,
            onTick: (tick) => send({ type: "tick", ...tick }),
          });
          if (closed) unsubscribe();
        } catch (err) {
          send({
            type: "error",
            message: err instanceof Error ? err.message : "stream failed",
          });
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }

        // A DATA heartbeat, not an SSE comment: comment lines never reach
        // EventSource.onmessage, so the client could not tell a silently dead
        // socket (mobile Chrome kills background connections without firing
        // onerror) from a quiet market. A visible heartbeat lets the client
        // run a staleness watchdog over ALL messages and rebuild when the
        // stream truly went dark.
        const heartbeat = setInterval(() => {
          if (closed) {
            clearInterval(heartbeat);
            return;
          }
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "heartbeat", time: Date.now() })}\n\n`,
              ),
            );
          } catch {
            clearInterval(heartbeat);
          }
        }, TICKS_HEARTBEAT_MS);

        const onAbort = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        };
        req.signal.addEventListener("abort", onAbort);
      },
      cancel() {
        closed = true;
        unsubscribe?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
